declare module '@tanstack/react-query' {
  export interface UseQueryOptions<T> { enabled?: boolean; queryKey?: unknown[]; queryFn?: (c: { signal: AbortSignal }) => Promise<T> }
  export interface UseMutationOptions<T, E, V> { onSuccess?: (d: T, v: V) => void; mutationFn?: (v: V) => Promise<T>; _e?: E }
  export function useQuery<T>(o: { queryKey: unknown[]; queryFn: (c: { signal: AbortSignal }) => Promise<T>; enabled?: boolean }): { data?: T };
  export function useMutation<T, E, V>(o: { mutationFn: (v: V) => Promise<T>; onSuccess?: (d: T, v: V) => void }): { mutate: (v: V) => void; _e?: E };
}
