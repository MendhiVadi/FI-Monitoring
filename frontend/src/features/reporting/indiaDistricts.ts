import contract from "../../shared/contracts/dispute.json";

// The shared directory is a maintained intake vocabulary, not a boundary survey.
export const INDIA_STATES_AND_DISTRICTS: Record<string, string[]> = contract.districts;
export const ALL_INDIAN_STATES = Object.keys(INDIA_STATES_AND_DISTRICTS);
export function getDistrictsForState(stateName: string): string[] {
  return Object.hasOwn(INDIA_STATES_AND_DISTRICTS, stateName) ? INDIA_STATES_AND_DISTRICTS[stateName] : [];
}
