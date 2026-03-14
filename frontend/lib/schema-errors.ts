export const MISSING_PROFILES_INTERESTS_MESSAGE =
  "Database schema is missing profiles.interests. Run backend/supabase/migrations/005_users_spec_foundation.sql (or `supabase db push`) and reload.";

function readErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "";
}

export function isMissingProfilesInterestsColumn(error: unknown): boolean {
  const message = readErrorMessage(error).toLowerCase();
  return (
    message.includes("could not find the 'interests' column of 'profiles'") ||
    message.includes("column profiles.interests does not exist") ||
    message.includes("column \"interests\" does not exist")
  );
}
