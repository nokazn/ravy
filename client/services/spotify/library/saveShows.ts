import { Context } from '@nuxt/types';

export const saveShows = (context: Context) => {
  const { app } = context;

  return ({ showIdList }: { showIdList: string[] }): Promise<void> => {
    const { length } = showIdList;
    if (length === 0) {
      return Promise.resolve();
    }

    const limit = 20;
    const handler = (index: number) => {
      const ids = showIdList.slice(limit * index, limit).join(',');
      return app.$spotifyApi.$put('/me/shows', null, {
        params: {
          ids,
        },
      });
    };
    const handlerCounts = Math.ceil(length / limit);

    return Promise.all(new Array(handlerCounts)
      .fill(undefined)
      .map((_, i) => handler(i)))
      .then(() => {})
      .catch((err: Error) => {
        console.error({ err });
        throw err;
      });
  };
};
