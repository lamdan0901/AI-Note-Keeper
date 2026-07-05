import { createNotesTrashPurgeCronHandler } from "../../src/handlers/cron/notes-trash-purge";
import {
  resetCronAuthConfigForTests,
  setCronAuthConfigForTests,
} from "../../src/http/auth/require-cron";
import type { NotesTrashPurgeJob } from "../../src/server/notes-trash-purge";
import { startNextTestServer, type NextTestServer } from "./next-test-server";

export type NotesTrashPurgeCronTestServerDeps = Readonly<{
  purgeJob: NotesTrashPurgeJob;
  cronSecret?: string;
}>;

export const CRON_NOTES_TRASH_PURGE_PATH = "/cron/notes-trash-purge";

export const notesTrashPurgeCronAuthHeaders = (
  cronSecret: string,
): Readonly<Record<string, string>> => ({
  authorization: `Bearer ${cronSecret}`,
});

export const startNotesTrashPurgeCronTestServer = async (
  deps: NotesTrashPurgeCronTestServerDeps,
): Promise<NextTestServer> => {
  const cronSecret = deps.cronSecret ?? "test-cron-secret";
  setCronAuthConfigForTests({ cronSecret });

  const handler = createNotesTrashPurgeCronHandler({ purgeJob: deps.purgeJob });

  const server = await startNextTestServer({
    routes: [
      { method: "GET", pathname: CRON_NOTES_TRASH_PURGE_PATH, handler },
      { method: "POST", pathname: CRON_NOTES_TRASH_PURGE_PATH, handler },
    ],
  });

  return {
    ...server,
    close: async () => {
      resetCronAuthConfigForTests();
      await server.close();
    },
  };
};
