import type { AxiosError } from 'axios';
import type { Actions } from 'typed-vuex';

import type { ServerAPI } from 'shared/types';
import type { AuthState } from './state';
import type { AuthGetters } from './getters';
import type { AuthMutations } from './mutations';

export type AuthActions = {
  login: () => Promise<void>
  exchangeCodeWithAccessToken: (params: {
    code: string;
    state: string;
  }) => Promise<void>
  getUserData: () => Promise<void>
  getAccessToken: () => Promise<void>
  refreshAccessToken: () => Promise<void>
  logout: () => Promise<void>
  confirmAuthState: (params?: { checkPremium?: boolean } | undefined) => Promise<boolean>
}

export type RootActions = {
  'auth/login': AuthActions['login']
  'auth/exchangeCodeToAccessToken': AuthActions['exchangeCodeToAccessToken']
  'auth/getUserData': AuthActions['getUserData']
  'auth/getAccessToken': AuthActions['getAccessToken']
  'auth/refreshAccessToken': AuthActions['refreshAccessToken']
  'auth/logout': AuthActions['logout']
  'auth/confirmAuthState': AuthActions['confirmAuthState']
}

const actions: Actions<AuthState, AuthActions, AuthGetters, AuthMutations> = {
  async login({ commit, dispatch }) {
    const data = await this.$server.auth.login();

    if (data.accessToken != null && data.expireIn != null) {
      commit('SET_ACCESS_TOKEN', data.accessToken);
      commit('SET_EXPIRATION_MS', data.expireIn);

      await dispatch('getUserData');
      // TODO
      this.$router.push('/');
      return;
    }
    if (data.url != null) {
      window.location.href = data.url;
      return;
    }
    console.error('トークン取得時にエラーが発生しました。');
    this.$toast.pushError('トークン取得時にエラーが発生し、ログインできません。');
  },

  async exchangeCodeWithAccessToken({ commit }, { code, state }) {
    const { accessToken, expireIn } = await this.$server.auth.callback({
      code,
      state,
    });

    commit('SET_ACCESS_TOKEN', accessToken);
    commit('SET_EXPIRATION_MS', expireIn);
  },

  async getAccessToken({ commit }) {
    const { accessToken, expireIn } = await this.$server.auth.root();

    commit('SET_ACCESS_TOKEN', accessToken);
    commit('SET_EXPIRATION_MS', expireIn);
  },

  async getUserData({ state, commit }): Promise<void> {
    if (state.accessToken == null) return;

    const userData = await this.$spotify.users.getCurrentUserProfile();
    commit('SET_USER_DATA', userData);
  },

  async refreshAccessToken({
    state,
    getters,
    commit,
    dispatch,
  }) {
    const { authState, accessToken } = state;
    // 現在ログイン済でないときは更新しない
    if (authState == null || accessToken == null) return;

    // トークン更新中であれば待機して、期限切れのときのみ更新
    await getters.finishedRefreshingToken();
    if (!getters.isTokenExpired()) return;

    // 先に expireIn を設定しておき、他の action で refreshAccessToken されないようにする
    const currentExpirationMs = state.expirationMs;
    commit('SET_EXPIRATION_MS', undefined);
    commit('SET_IS_REFRESHING', true);

    await this.$server.auth.refresh({
      authState,
      accessToken,
    })
      .then((token) => {
        commit('SET_ACCESS_TOKEN', token.accessToken);
        commit('SET_EXPIRATION_MS', token.expireIn);
      })
      .catch(async (err: AxiosError<ServerAPI.Auth.Token>) => {
        console.error({ err });
        if (err.response?.data == null) {
          commit('SET_ACCESS_TOKEN', undefined);
          commit('SET_EXPIRATION_MS', undefined);
          await dispatch('logout');
          this.$router.push('/login');
          this.$toast.pushError('トークンを取得できなかったためログアウトしました。');
        } else if (err.response?.status === 409) {
          // コンフリクトして現在のトークンが一致しない場合 (409) は再取得
          await dispatch('getAccessToken');
          // 一度リセットした expirationMs を元に戻す
          commit('SET_EXPIRATION_MS', currentExpirationMs);
        }
      })
      .finally(() => {
        commit('SET_IS_REFRESHING', false);
      });
  },

  async logout({ commit, dispatch }) {
    // プレイヤーをリセット
    dispatch('player/disconnectPlayer', undefined, { root: true });
    // セッションを削除
    await this.$server.auth.logout();

    commit('SET_ACCESS_TOKEN', undefined);
    commit('SET_USER_DATA', undefined);
    // playback をリセット
    dispatch('playback/resetPlayback', undefined, { root: true });
  },

  async confirmAuthState({ getters, dispatch }, params) {
    if (!getters.isLoggedin || getters.isTokenExpired()) {
      await dispatch('refreshAccessToken');
    }
    return params?.checkPremium
      ? getters.isLoggedin && getters.isPremium
      : getters.isLoggedin;
  },
};

export default actions;
