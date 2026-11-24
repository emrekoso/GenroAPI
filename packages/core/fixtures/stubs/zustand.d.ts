declare module 'zustand' {
  type Set<S> = (p: Partial<S> | ((s: S) => Partial<S>)) => void;
  export function create<S>(): (init: (set: Set<S>) => S) => () => S;
}
