/**
 * TypeScript shapes of the database, matching
 * `supabase/migrations/` (001 to 005) exactly. Keep the two in sync: every
 * change to the SQL needs the same change here.
 *
 * `Database` is in the format supabase-js expects, so queries are checked:
 * `createClient<Database>()` knows every table, column and allowed value.
 * These are `type` aliases, not interfaces, on purpose: supabase-js only
 * accepts row shapes that TypeScript can treat as plain records.
 */

// --- Allowed values (each mirrors a CHECK constraint) ------------------------

import type {
  Amenity,
  BhkType,
  MoveInTimeframe,
  Society,
} from "@/lib/constants/prompts";

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const MODES = ["have_flat", "need_flat"] as const;
/** have_flat: has a flat with space. need_flat: looking for one. */
export type Mode = (typeof MODES)[number];

// Societies, BHK types, amenities and move-in timeframes are defined once
// in `@/lib/constants/prompts` (with the user-facing labels).
export type {
  Amenity,
  BhkType,
  MoveInTimeframe,
  Society,
} from "@/lib/constants/prompts";

export type SwipeAction = "like" | "pass";
export type LikedTargetType = "photo" | "prompt" | "listing";

/** One profile prompt; a profile has at most 3. */
export type BioPrompt = {
  question: string;
  answer: string;
}

// --- Rows -----------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  /** Never readable by other users (column privileges), only by its owner via auth. */
  email: string;
  full_name: string | null;
  gender: Gender | null;
  year_of_study: number | null;
  department: string | null;
  mode: Mode | null;
  /** Set by the database only: an @srmist.edu.in address that is confirmed. */
  is_srm_verified: boolean;
  avatar_url: string | null;
  bio_prompts: BioPrompt[];
  /** need_flat preferences (migration 002). */
  preferred_societies: Society[];
  /** Whole rupees per month, per person. */
  max_budget: number | null;
  move_in_timeframe: MoveInTimeframe | null;
  /**
   * An invented example student from `npm run seed` (migration 005).
   * Always shown with a "Sample" label. Set by the seed script only.
   */
  is_sample: boolean;
  /** ISO timestamps. */
  created_at: string;
  updated_at: string;
}

export type ListingRow = {
  id: string;
  owner_id: string;
  society: Society;
  bhk_type: BhkType;
  vacant_spots: number;
  /** Whole rupees per month. */
  rent_per_person: number;
  maintenance_per_person: number;
  deposit_per_person: number;
  setup_cost: number;
  amenities: Amenity[];
  /** Public URLs in the roomie-media bucket. */
  photos: string[];
  is_active: boolean;
  created_at: string;
}

export type SwipeRow = {
  id: string;
  sender_id: string;
  receiver_id: string;
  action: SwipeAction;
  liked_target_type: LikedTargetType | null;
  liked_target_ref: string | null;
  comment: string | null;
  created_at: string;
}

export type MatchRow = {
  id: string;
  /** The smaller of the two user ids. */
  user_a: string;
  user_b: string;
  initial_comment: string | null;
  created_at: string;
}

export type MessageRow = {
  id: string;
  match_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

/**
 * The profile columns other users may read: everything except `email`.
 * Use this list in `.select()`, because `select('*')` is refused for
 * profiles (it would include the email column).
 */
export const PUBLIC_PROFILE_COLUMNS =
  "id, full_name, gender, year_of_study, department, mode, is_srm_verified, avatar_url, bio_prompts, preferred_societies, max_budget, move_in_timeframe, is_sample, created_at, updated_at";
export type PublicProfile = Omit<ProfileRow, "email">;

// --- What each role may write (mirrors the GRANTs in the migration) -------------

/** Profiles are created by the signup trigger, never by the app. */
type ProfileInsert = never;
/** The only fields a user may change on their own profile. */
type ProfileUpdate = Partial<
  Pick<
    ProfileRow,
    | "full_name"
    | "gender"
    | "year_of_study"
    | "department"
    | "mode"
    | "avatar_url"
    | "bio_prompts"
    | "preferred_societies"
    | "max_budget"
    | "move_in_timeframe"
  >
>;

type ListingInsert = Pick<
  ListingRow,
  "owner_id" | "society" | "bhk_type" | "rent_per_person"
> &
  Partial<
    Pick<
      ListingRow,
      | "id"
      | "vacant_spots"
      | "maintenance_per_person"
      | "deposit_per_person"
      | "setup_cost"
      | "amenities"
      | "photos"
      | "is_active"
    >
  >;
type ListingUpdate = Partial<Omit<ListingRow, "id" | "owner_id" | "created_at">>;

type SwipeInsert = Pick<SwipeRow, "sender_id" | "receiver_id" | "action"> &
  Partial<
    Pick<SwipeRow, "liked_target_type" | "liked_target_ref" | "comment">
  >;

/** The id may be chosen by the app (migration 004); the time never is. */
type MessageInsert = Pick<MessageRow, "match_id" | "sender_id" | "content"> &
  Partial<Pick<MessageRow, "id">>;

// --- The supabase-js Database type ----------------------------------------------

type Relationship = {
  foreignKeyName: string;
  columns: string[];
  isOneToOne: boolean;
  referencedRelation: string;
  referencedColumns: string[];
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: ProfileInsert;
        Update: ProfileUpdate;
        Relationships: Relationship[];
      };
      listings: {
        Row: ListingRow;
        Insert: ListingInsert;
        Update: ListingUpdate;
        Relationships: [
          {
            foreignKeyName: "listings_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      swipes: {
        Row: SwipeRow;
        Insert: SwipeInsert;
        /** Decisions are final. */
        Update: never;
        Relationships: Relationship[];
      };
      matches: {
        Row: MatchRow;
        /** Created by the mutual-like trigger only. */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
      };
      messages: {
        Row: MessageRow;
        Insert: MessageInsert;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "messages_match_id_fkey";
            columns: ["match_id"];
            isOneToOne: false;
            referencedRelation: "matches";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      /** The newest message in each match you're part of (migration 004). */
      latest_messages: {
        Row: MessageRow;
        Relationships: [];
      };
    };
    Functions: {
      is_srm_email: { Args: { address: string }; Returns: boolean };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
