// The migration schema and one-shot migrator exist, but the synchronous JSON
// repositories have not yet been replaced with PostgreSQL repositories.
// Keep this gate fail-closed so a future startup wiring cannot silently claim
// a PG runtime cutover while continuing to read or write JSON.

export const PG_RUNTIME_STORE_HYDRATION_READY = false;

export async function hydratePgRuntimeStores(): Promise<never> {
  throw new Error("pg_runtime_store_hydration_not_implemented");
}
