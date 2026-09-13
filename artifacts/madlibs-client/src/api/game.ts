// The only place the UI touches the API transport. Components import from here,
// never from '@workspace/api-client-react' directly, so swapping the transport
// (generated hooks, AWS Blocks, plain fetch) is a single-file change.
//
// This layer also absorbs the generated `{ data: payload }` call convention:
// everything exported below takes the payload directly.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useGetConfig as useGeneratedGetConfig,
  useJoinGame as useGeneratedJoinGame,
  usePollGame as useGeneratedPollGame,
  useSubmitWord as useGeneratedSubmitWord,
  type JoinResponse,
  type PlayerCredentials,
  type PollResponse,
  type RoundPart,
  type Stats,
  type SubmitInput,
  type SubmitResponse,
} from '@workspace/api-client-react';

export type { PlayerCredentials, PollResponse, RoundPart, Stats, SubmitInput };

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

export function useGetConfig() {
  return useGeneratedGetConfig();
}

export function useJoinGame() {
  const mutation = useGeneratedJoinGame();
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const join = useCallback(
    (
      credentials: PlayerCredentials,
      handlers?: { onSuccess?: (result: JoinResponse) => void; onError?: (error: unknown) => void },
    ) => {
      mutateRef.current({ data: credentials }, handlers);
    },
    [],
  );

  return { join, isPending: mutation.isPending };
}

export function useSubmitWord() {
  const mutation = useGeneratedSubmitWord();
  const mutateRef = useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;

  const submit = useCallback(
    (input: SubmitInput, handlers?: { onSuccess?: (result: SubmitResponse) => void }) => {
      mutateRef.current({ data: input }, handlers);
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
  const pollGame = useGeneratedPollGame();
  const [poll, setPoll] = useState<PollResponse | undefined>();
  const [failure, setFailure] = useState<PollFailure | null>(null);

  const credentialsRef = useRef(getCredentials());
  const onSessionEndedRef = useRef(onSessionEnded);
  onSessionEndedRef.current = onSessionEnded;

  // Hold mutateAsync in a ref, not mutate: the loop below is driven off the
  // awaited promise rather than react-query's per-call callbacks. A mutation
  // hook keeps one options slot, so any other poll call would replace this
  // loop's onSettled and the loop would never reschedule.
  const pollRef = useRef(pollGame.mutateAsync);
  pollRef.current = pollGame.mutateAsync;

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
        const result = await pollRef.current({ data: credentials });
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
    void pollRef
      .current({ data: credentials })
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
    void pollRef.current({ data: credentials }).then(setPoll).catch(() => {});
  }, []);

  return { poll, failure, retry, refresh, credentials: credentialsRef.current };
}
