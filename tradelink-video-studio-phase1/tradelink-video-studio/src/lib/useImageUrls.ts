import { useEffect, useState } from 'react';
import { signedUrls } from './images';

/** Signed (temporary) links for private images. Re-fetched whenever the set of paths changes. */
export function useImageUrls(paths: Array<string | null | undefined>): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = [...new Set(paths.filter((p): p is string => !!p))].sort().join('|');
  useEffect(() => {
    let live = true;
    const list = key === '' ? [] : key.split('|');
    void signedUrls(list).then((u) => {
      if (live) setUrls(u);
    });
    return () => {
      live = false;
    };
  }, [key]);
  return urls;
}
