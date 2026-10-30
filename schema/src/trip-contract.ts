/* Generated from trip-contract.schema.json. Do not edit. */

export interface TripContract {
  schemaVersion: "1.0.0";
  id: string;
  title: string;
  country: string;
  currency: string;
  locale: "pt-BR" | "en";
  startDate: string;
  endDate: string;
  /**
   * @maxItems 30
   */
  travelers: Traveler[];
  /**
   * @maxItems 200
   */
  services: Service[];
  /**
   * @maxItems 200
   */
  dependencies: Dependency[];
  /**
   * @maxItems 366
   */
  overnightExemptions: {
    date: string;
    reason: string;
  }[];
}
export interface Traveler {
  id: string;
  label: string;
  ageGroup: "infant" | "child" | "adult" | "senior" | "undisclosed";
  /**
   * @maxItems 20
   */
  needs:
    | []
    | ["step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ]
    | [
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other",
        "step_free" | "child_seat" | "stroller" | "crib" | "quiet_breaks" | "dietary" | "assistance" | "other"
      ];
}
export interface Service {
  id: string;
  kind: "flight" | "bus" | "hotel" | "rental_home" | "activity" | "car_rental" | "insurance" | "transfer";
  title: string;
  country: string;
  regulatoryScope?: "br_air_transport" | "br_interstate_regular_bus" | "other" | "unknown";
  provider: {
    name: string;
    category:
      | "airline"
      | "bus_operator"
      | "hotel"
      | "rental_host"
      | "agency"
      | "tour_operator"
      | "guide"
      | "car_rental"
      | "insurer"
      | "other";
    registration: {
      scheme: string | null;
      value: string | null;
      status: "unknown" | "active" | "inactive" | "not_applicable";
      sourceUrl: string | null;
      checkedAt: string | null;
    };
    cadastur: {
      applicability: "required" | "optional" | "not_applicable" | "unknown";
      status: "unknown" | "active" | "inactive" | "not_applicable";
      sourceUrl: string | null;
      checkedAt: string | null;
    };
    contact: string | null;
  };
  reservation: {
    state: "quote" | "booked" | "cancelled" | "completed";
    reference: string | null;
    confirmation: "not_checked" | "confirmed" | "failed";
    confirmationDocumentId: string | null;
    paymentChannel: "unknown" | "platform" | "direct" | "outside_agreed_channel";
  };
  start: Time;
  end: Time;
  location?: string | null;
  price: Money | null;
  cancellation: {
    summary: string | null;
    deadline: string | null;
    documentId: string | null;
  };
  baggage: string | null;
  /**
   * @maxItems 100
   */
  documentIds: string[];
  fieldSources?: {
    "reservation.reference"?: string;
    "cancellation.summary"?: string;
    baggage?: string;
  };
  /**
   * @maxItems 30
   */
  requirements: {
    code: string;
    status: "unknown" | "confirmed" | "unavailable";
  }[];
}
export interface Time {
  local: string;
  timeZone: string | null;
}
export interface Money {
  currency: string;
  baseMinor: number;
  /**
   * @maxItems 40
   */
  fees: {
    label: string;
    amountMinor: number;
  }[];
  totalMinor: number;
}
export interface Dependency {
  from: string;
  to: string;
  minimumMinutes: number;
  basis: "traveler_preference" | "provider_policy" | "operational_assumption";
}
