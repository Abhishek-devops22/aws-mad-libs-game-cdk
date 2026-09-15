import { ApiNamespace, ApiError } from '@aws-blocks/blocks';
import {
  scope,
  configuredGameServerUrl,
  credentialsFrom,
  helloPayload,
  upstreamFetch,
  upstreamErrorText,
  upstreamStatus,
  requestOrigin,
} from './resources.js';
import type { UpstreamHello } from './resources.js';

// ---------------------------------------------------------------------------
// API Namespace — all 5 routes from the Express server
// ---------------------------------------------------------------------------

export const api = new ApiNamespace(scope, 'api', (context) => ({
  // GET /api/healthz
  async healthz() {
    return { status: 'ok' };
  },

  // GET /api/config
  async getConfig() {
    const gameServerUrl = await configuredGameServerUrl();
    return {
      gameServerUrl,
      fromEnv: Boolean(gameServerUrl),
    };
  },

  // POST /api/join
  async joinGame(data: {
    token: string;
    displayName: string;
    playerKey: string;
    gameServerUrl: string;
  }) {
    if (
      !data.token ||
      !data.displayName ||
      !data.playerKey ||
      !data.gameServerUrl
    ) {
      throw new ApiError(
        'Enter a join code, your name, and a game server URL.',
        400,
      );
    }

    const credentials = credentialsFrom(data);
    if (!credentials) {
      throw new ApiError(
        'Enter a valid http or https game server URL.',
        400,
      );
    }

    const health = await upstreamFetch(
      `${credentials.gameServerUrl}/game/health`,
    );
    if (!health.response) {
      throw new ApiError(
        `Cannot reach the game server at ${credentials.gameServerUrl}`,
        502,
      );
    }
    if (
      !health.response.ok ||
      typeof health.data !== 'object' ||
      health.data === null ||
      (health.data as { ok?: boolean }).ok !== true
    ) {
      throw new ApiError(
        "That doesn't look like a madlibs game server.",
        400,
      );
    }

    const origin = requestOrigin(context.request.headers);
    const hello = await upstreamFetch(
      `${credentials.gameServerUrl}/game/hello`,
      {
        method: 'POST',
        body: JSON.stringify(helloPayload(credentials, origin)),
      },
    );
    const helloError = upstreamErrorText(hello.data);
    if (!hello.response) {
      throw new ApiError(
        `Cannot reach the game server at ${credentials.gameServerUrl}`,
        502,
      );
    }
    if (!hello.response.ok || helloError) {
      throw new ApiError(
        helloError ?? 'The game server rejected the join.',
        upstreamStatus(hello.response),
      );
    }

    return {
      ok: true,
      player: (hello.data as UpstreamHello).player,
    };
  },

  // POST /api/poll
  async pollGame(data: {
    token: string;
    displayName: string;
    playerKey: string;
    gameServerUrl: string;
  }) {
    if (
      !data.token ||
      !data.displayName ||
      !data.playerKey ||
      !data.gameServerUrl
    ) {
      throw new ApiError('Join the game again to keep playing.', 400);
    }

    const credentials = credentialsFrom(data);
    if (!credentials) {
      throw new ApiError(
        'Enter a valid http or https game server URL.',
        400,
      );
    }

    const origin = requestOrigin(context.request.headers);
    const hello = await upstreamFetch(
      `${credentials.gameServerUrl}/game/hello`,
      {
        method: 'POST',
        body: JSON.stringify(helloPayload(credentials, origin)),
      },
    );
    const helloError = upstreamErrorText(hello.data);
    if (!hello.response) {
      throw new ApiError(
        `Cannot reach the game server at ${credentials.gameServerUrl}`,
        502,
      );
    }
    if (!hello.response.ok || helloError) {
      throw new ApiError(
        helloError ?? 'The game server rejected the request.',
        upstreamStatus(hello.response),
      );
    }

    return hello.data as UpstreamHello;
  },

  // POST /api/submit
  async submitWord(data: {
    token: string;
    displayName: string;
    playerKey: string;
    gameServerUrl: string;
    word: string;
  }) {
    if (
      !data.token ||
      !data.displayName ||
      !data.playerKey ||
      !data.gameServerUrl ||
      !data.word
    ) {
      throw new ApiError('Enter one word up to 40 characters.', 400);
    }

    const credentials = credentialsFrom(data);
    if (!credentials) {
      throw new ApiError(
        'Enter a valid http or https game server URL.',
        400,
      );
    }

    const submission = await upstreamFetch(
      `${credentials.gameServerUrl}/game/submit`,
      {
        method: 'POST',
        body: JSON.stringify({
          token: credentials.token,
          playerKey: credentials.playerKey,
          word: data.word,
        }),
      },
    );
    const submissionError = upstreamErrorText(submission.data);
    if (!submission.response) {
      throw new ApiError(
        `Cannot reach the game server at ${credentials.gameServerUrl}`,
        502,
      );
    }
    if (!submission.response.ok || submissionError) {
      throw new ApiError(
        submissionError ?? 'The game server rejected the submission.',
        upstreamStatus(submission.response),
      );
    }

    return submission.data as {
      ok: boolean;
      word?: string;
      blankIndex?: number;
      error?: string;
    };
  },
}));
