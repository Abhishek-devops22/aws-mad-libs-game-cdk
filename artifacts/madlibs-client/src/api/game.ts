// The only place the UI touches the API transport. Components import from here,
// so swapping from the generated orval client to AWS Blocks is a single-file change.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from 'aws-blocks';

// ---------------------------------------------------------------------------
// Re-exported types  — extracted from the aws-blocks api method signatures so
// that components can stay typed without importing aws-blocks directly.
// ---------------------------------------------------------------------------

export type PlayerCredentials = {
  token: string;
  displayName: string;
  playerKey: string;
  gameServerUrl: string;
};

export type SubmitInput = PlayerCredentials & { word: string };

/** Shape returned by api.joinGame() */
type JoinResponse = Awaited<ReturnType<typeof api.joinGame>>;

/** Shape returned by api.pollGame() */
export type PollResponse = Awaited<ReturnType<typeof api.pollGame>>;

/** Shape returned by api.submitWord() */
type SubmitResponse = Awaited<ReturnType<typeof api.submitWord>>;

/** A single element of round.parts */
export type RoundPart = NonNullable<PollResponse['round']> extends infer R
  ? R extends { parts: (infer P)[] }
    ? P
    : never
  : never;

export type Stats = NonNullable<PollResponse['stats']>;

export type PollFailure = { message: string; status?: number };

const DEFAULT_POLL_MS = 1000;

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const record = error as {
      data?: { error?: string };
      response?: { data?: { error?: string } };
      message?: string;
    };
    return record.data?.error || record.response?.data?.error || record.message || fallback;
  }
  return fallback;
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as { status?: number; response?: { status?: number } };
  return record.status || record.response?.status;
}

export { errorMessage as apiError, errorStatus as apiStatus };

// ---------------------------------------------------------------------------
// useGetConfig — wraps api.getConfig() in a TanStack useQuery
// ---------------------------------------------------------------------------

export function useGetConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api.getConfig(),
  });
}

// ---------------------------------------------------------------------------
// useJoinGame — wraps api.joinGame() in a TanStack useMutation
// ---------------------------------------------------------------------------

export function useJoinGame() {
  const mutation = useMutation({
    mutationKey: ['joinGame'],
    mutationFn: (credentials: PlayerCredentials) => api.joinGame(credentials),
  });
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const join = useCallback(
    (
      credentials: PlayerCredentials,
      handlers?: { onSuccess?: (result: JoinResponse) => void; onError?: (error: unknown) => void },
    ) => {
      mutateRef.current(credentials, handlers);
    },
    [],
  );

  return { join, isPending: mutation.isPending };
}

// ---------------------------------------------------------------------------
// useSubmitWord — wraps api.submitWord() in a TanStack useMutation
// ---------------------------------------------------------------------------

export function useSubmitWord() {
  const mutation = useMutation({
    mutationKey: ['submitWord'],
    mutationFn: (input: SubmitInput) => api.submitWord(input),
  });
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const submit = useCallback(
    (input: SubmitInput, handlers?: { onSuccess?: (result: SubmitResponse) => void }) => {
      mutateRef.current(input, handlers);
    },
    [],
  );

  return {
    submit,
    reset: mutation.reset,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}

// ---------------------------------------------------------------------------
// useGamePoll — long-poll loop using api.pollGame()
// ---------------------------------------------------------------------------

/**
 * Owns the poll loop and its failure state. Credentials are read once on mount
 * — the server keeps no session, so they cannot change mid-game without a
 * remount.
 */
export function useGamePoll({
  getCredentials,
  onSessionEnded,
  intervalMs = DEFAULT_POLL_MS,
}: {
  getCredentials: () => PlayerCredentials | null;
  onSessionEnded: () => void;
  intervalMs?: number;
}) {
  const [poll, setPoll] = useState<PollResponse | undefined>();
  const [failure, setFailure] = useState<PollFailure | null>(null);

  const credentialsRef = useRef(getCredentials());
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;

  // Use a ref for the poll function so the effect closure always calls the
  // latest version without re-triggering the effect.
  const pollFnRef = useRef((credentials: PlayerCredentials) => api.pollGame(credentials));

  useEffect(() => {
    const credentials = credentialsRef.current;
    if (!credentials) {
      onSessionEndedRef.current();
      return;
    }

    // Schedule the next poll only once the previous one settles, so a slow
    // request cannot stack another on top of it.
    let timer = 0;
    let stopped = false;

    const request = async () => {
      try {
        const result = await pollFnRef.current(credentials);
        setPoll(result);
        if (!result.ok) {
          setFailure({ message: result.error || 'The game server returned an invalid state.' });
        } else {
          setFailure(null);
        }
      } catch (error) {
        setFailure({ message: errorMessage(error, 'The game server is unreachable.'), status: errorStatus(error) });
      } finally {
        if (!stopped) timer = window.setTimeout(request, intervalMs);
      }
    };

    void request();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [intervalMs]);

  // Retry after a visible failure: clears the failure only on a good result, so
  // a second bad result leaves the error screen up.
  const retry = useCallback(() => {
    const credentials = credentialsRef.current;
    if (!credentials) return;
    void api
      .pollGame(credentials)
      .then((result) => {
        setPoll(result);
        if (result.ok) setFailure(null);
      })
      .catch(() => {});
  }, []);

  // Opportunistic refresh (e.g. straight after a submit). Never surfaces an
  // error — the loop will report anything real on its next tick.
  const refresh = useCallback(() => {
    const credentials = credentialsRef.current;
    if (!credentials) return;
    void api.pollGame(credentials).then(setPoll).catch(() => {});
  }, []);

  return { poll, failure, retry, refresh, credentials: credentialsRef.current };
}
