/**
 * Migrations contributed by plugin packages.
 *
 * Migrations normally live as files in `migrations/`, discovered by filename.
 * A plugin installed from npm can't put a file there, so it exports its
 * migrations as objects instead and this list wires them in. Both kinds share
 * one `migrations` table and one applied/pending calculation.
 *
 * Registration is an explicit list rather than plugin self-registration, for
 * the same reason the route tables in `routes/` are static: what runs against
 * your database should be readable in one place, not assembled by import
 * side effects whose order you can't see.
 *
 * To install a plugin's migrations, import and spread them:
 *
 * ```ts
 * import { analyticsMigrations } from "@alexpricedev/billet-analytics";
 *
 * export const pluginMigrations: PluginMigration[] = [...analyticsMigrations];
 * ```
 */
import type { SQL } from "bun";

export type PluginMigration = {
  /**
   * Stable primary key in the `migrations` table — it can never change once
   * released, or every existing database re-runs the migration.
   *
   * Namespace it with the plugin name (`analytics_001_create_events`). That
   * keeps it clear of the numeric ids this app's own migration files use, and
   * digits sorting before letters in ASCII means plugin ids land after core
   * ids under a plain string sort.
   */
  id: string;
  /** Human-readable label, recorded alongside the id. */
  name: string;
  up: (db: SQL) => Promise<void>;
  /**
   * Optional. A plugin with no `down` can't be rolled back — `migrate:down`
   * fails rather than leaving the database and the migrations table disagreeing
   * about what's applied.
   */
  down?: (db: SQL) => Promise<void>;
};

export const pluginMigrations: PluginMigration[] = [];
