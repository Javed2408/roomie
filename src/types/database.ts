/**
 * TypeScript shapes of the database, matching
 * `supabase/migrations/` (001 to 012) exactly. Keep the two in sync: every
 * change to the SQL needs the same change here.
 *
 * `Database` is in the format supabase-js expects, so queries are checked:
 * `createClient<Database>()` knows every table, column and allowed value.
 * These are `type` aliases, not interfaces, on purpose: supabase-js only
 * accepts row shapes that TypeScript can treat as plain records.
 */

// --- Allowed values (each mirrors a CHECK constraint) ------------------------

import type {
  Cleanliness,
  DiscoverHousing,
  FoodHabit,
  GenderPreference,
  GroupMembershipStatus,
  GroupRole,
  GroupStatus,
  GuestFrequency,
  HousingStatus,
  NoiseTolerance,
  Personality,
  RoomType,
  Seeking,
  SleepSchedule,
  SmokingHabit,
  SocialLife,
  StudyHabits,
} from "@/lib/constants/preferences";
import type {
  Amenity,
  BhkType,
  MoveInTimeframe,
  Society,
} from "@/lib/constants/prompts";

export const GENDERS = ["male", "female", "other"] as const;
export type Gender = (typeof GENDERS)[number];

export const MODES = ["have_flat", "need_flat"] as const;
/**
 * Legacy: have_flat / need_flat. A mirror of housing_status (migration
 * 007), kept in sync by the database. New code should use HousingStatus.
 */
export type Mode = (typeof MODES)[number];

// Societies, BHK types, amenities and move-in timeframes are defined once
// in `@/lib/constants/prompts`; housing, discovery, lifestyle and group
// values in `@/lib/constants/preferences` (both with user-facing labels).
export type {
  Amenity,
  BhkType,
  MoveInTimeframe,
  Society,
} from "@/lib/constants/prompts";
export type {
  Cleanliness,
  DiscoverHousing,
  FoodHabit,
  GenderPreference,
  GroupMembershipStatus,
  GroupRole,
  GroupStatus,
  GuestFrequency,
  HousingStatus,
  NoiseTolerance,
  Personality,
  RoomType,
  Seeking,
  SleepSchedule,
  SmokingHabit,
  SocialLife,
  StudyHabits,
} from "@/lib/constants/preferences";

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
  /** Legacy mirror of housing_status (007). */
  mode: Mode | null;
  /** Set by the database only: an @srmist.edu.in address that is confirmed. */
  is_srm_verified: boolean;
  /** The main photo; mirrors profile_photos position 0 (008). */
  avatar_url: string | null;
  bio_prompts: BioPrompt[];
  /** A short personal introduction, up to 300 characters (012). */
  about: string | null;
  /** Legacy mirrors of practical_preferences (008); first added in 002. */
  preferred_societies: Society[];
  /** Whole rupees per month, per person. Mirrors practical_preferences.budget_max. */
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

/**
 * An accommodation listing. A student may have several (up to 10), but at
 * most one live (`is_active`) at a time (migration 009).
 */
export type ListingRow = {
  id: string;
  owner_id: string;
  society: Society;
  bhk_type: BhkType;
  /** Spots open: the available occupancy. */
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
  // --- Added in 009 ---
  description: string | null;
  /** Rooms available (1-10). */
  available_rooms: number;
  /** People already living there (0-10). */
  current_flatmates: number;
  /** ISO date; null means available now. */
  available_from: string | null;
  preferred_flatmate_gender: GenderPreference;
  /** Short notes on the flatmate wanted. */
  flatmate_preferences: string | null;
  updated_at: string;
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

// --- Student details around the profile (007, 008) ---------------------------

/** What a student has right now; independent of whom they discover. */
export type HousingStatusRow = {
  profile_id: string;
  status: HousingStatus;
  created_at: string;
  updated_at: string;
}

/** Whom a student wants to see, and how they want to live. */
export type DiscoveryPreferencesRow = {
  profile_id: string;
  discover_housing: DiscoverHousing;
  seeking: Seeking;
  created_at: string;
  updated_at: string;
}

export type ProfilePhotoRow = {
  id: string;
  profile_id: string;
  url: string;
  /** 0 is the main photo (mirrors profiles.avatar_url); up to 5. */
  position: number;
  created_at: string;
}

/** The catalogue of interests students pick from. */
export type InterestRow = {
  slug: string;
  label: string;
}

export type ProfileInterestRow = {
  profile_id: string;
  interest: string;
  created_at: string;
}

/** Lifestyle and personality (all optional). */
export type LifestylePreferencesRow = {
  profile_id: string;
  sleep_schedule: SleepSchedule | null;
  cleanliness: Cleanliness | null;
  social_life: SocialLife | null;
  study_habits: StudyHabits | null;
  guests: GuestFrequency | null;
  noise_tolerance: NoiseTolerance | null;
  smoking: SmokingHabit | null;
  food_habits: FoodHabit | null;
  personality: Personality | null;
  /** Wants a shared cleaning rota (012). */
  cleaning_rota: boolean | null;
  /** Wants a heads-up before guests visit (012). */
  guest_notice: boolean | null;
  created_at: string;
  updated_at: string;
}

/**
 * Budget, place and requirements. Every profile has one row, readable only
 * by its owner (011). Societies, max budget and move-in are mirrored onto
 * the profile, which is what others see.
 */
export type PracticalPreferencesRow = {
  profile_id: string;
  /** Whole rupees per month, per person. */
  budget_min: number | null;
  budget_max: number | null;
  preferred_societies: Society[];
  move_in_timeframe: MoveInTimeframe | null;
  room_type: RoomType | null;
  preferred_bhk_types: BhkType[];
  required_amenities: Amenity[];
  flatmate_gender: GenderPreference | null;
  created_at: string;
  updated_at: string;
}

// --- Groups (010) ---------------------------------------------------------------

export type GroupRow = {
  id: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  /** Null if the creator's account was deleted. */
  created_by: string | null;
  max_members: number;
  preferred_gender: GenderPreference;
  requirements: string | null;
  preferred_societies: Society[];
  /** Whole rupees per month, per person. */
  budget_max: number | null;
  move_in_timeframe: MoveInTimeframe | null;
  preferred_bhk_types: BhkType[];
  status: GroupStatus;
  is_discoverable: boolean;
  created_at: string;
  updated_at: string;
}

/** Change these only through the group functions (Database["public"]["Functions"]). */
export type GroupMemberRow = {
  group_id: string;
  profile_id: string;
  /** "admin" is the group's representative. */
  role: GroupRole;
  status: GroupMembershipStatus;
  invited_by: string | null;
  /** When they became an active member. */
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * The profile columns other users may read: everything except `email`.
 * Use this list in `.select()`, because `select('*')` is refused for
 * profiles (it would include the email column).
 */
export const PUBLIC_PROFILE_COLUMNS =
  "id, full_name, gender, year_of_study, department, mode, is_srm_verified, avatar_url, bio_prompts, about, preferred_societies, max_budget, move_in_timeframe, is_sample, created_at, updated_at";
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
    | "about"
    | "preferred_societies"
    | "max_budget"
    | "move_in_timeframe"
  >
>;

/** The listing fields a student may write (009): never id, owner or times. */
type ListingWritable = Omit<ListingRow, "id" | "owner_id" | "created_at" | "updated_at">;
type ListingInsert = Pick<ListingRow, "owner_id" | "society" | "bhk_type" | "rent_per_person"> &
  Partial<ListingWritable>;
type ListingUpdate = Partial<ListingWritable>;

/** Fields the database fills in itself. */
type Generated = "created_at" | "updated_at";

type HousingStatusInsert = Pick<HousingStatusRow, "profile_id" | "status">;
type HousingStatusUpdate = Pick<HousingStatusRow, "status">;

type DiscoveryPreferencesInsert = Pick<DiscoveryPreferencesRow, "profile_id"> &
  Partial<Pick<DiscoveryPreferencesRow, "discover_housing" | "seeking">>;
type DiscoveryPreferencesUpdate = Partial<Pick<DiscoveryPreferencesRow, "discover_housing" | "seeking">>;

type LifestylePreferencesInsert = Pick<LifestylePreferencesRow, "profile_id"> &
  Partial<Omit<LifestylePreferencesRow, "profile_id" | Generated>>;
type LifestylePreferencesUpdate = Partial<Omit<LifestylePreferencesRow, "profile_id" | Generated>>;

type PracticalPreferencesInsert = Pick<PracticalPreferencesRow, "profile_id"> &
  Partial<Omit<PracticalPreferencesRow, "profile_id" | Generated>>;
type PracticalPreferencesUpdate = Partial<Omit<PracticalPreferencesRow, "profile_id" | Generated>>;

/** created_by must be the signed-in student; they become the first admin. */
type GroupInsert = Pick<GroupRow, "name" | "created_by"> &
  Partial<
    Pick<
      GroupRow,
      | "description"
      | "avatar_url"
      | "max_members"
      | "preferred_gender"
      | "requirements"
      | "preferred_societies"
      | "budget_max"
      | "move_in_timeframe"
      | "preferred_bhk_types"
      | "is_discoverable"
    >
  >;
/** Admins only. */
type GroupUpdate = Partial<Omit<GroupRow, "id" | "created_by" | Generated>>;

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
      housing_status: {
        Row: HousingStatusRow;
        Insert: HousingStatusInsert;
        Update: HousingStatusUpdate;
        Relationships: Relationship[];
      };
      discovery_preferences: {
        Row: DiscoveryPreferencesRow;
        Insert: DiscoveryPreferencesInsert;
        Update: DiscoveryPreferencesUpdate;
        Relationships: Relationship[];
      };
      profile_photos: {
        Row: ProfilePhotoRow;
        /** Only through set_profile_photos() (012). */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
      };
      interests: {
        Row: InterestRow;
        /** Read-only catalogue. */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
      };
      profile_interests: {
        Row: ProfileInterestRow;
        /** Only through set_profile_interests() (012). */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
      };
      lifestyle_preferences: {
        Row: LifestylePreferencesRow;
        Insert: LifestylePreferencesInsert;
        Update: LifestylePreferencesUpdate;
        Relationships: Relationship[];
      };
      practical_preferences: {
        Row: PracticalPreferencesRow;
        Insert: PracticalPreferencesInsert;
        Update: PracticalPreferencesUpdate;
        Relationships: Relationship[];
      };
      groups: {
        Row: GroupRow;
        Insert: GroupInsert;
        Update: GroupUpdate;
        Relationships: Relationship[];
      };
      group_members: {
        Row: GroupMemberRow;
        /** Only through the group functions below. */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
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
      /** The signed-in account is a confirmed @srmist.edu.in address (011). */
      is_eligible_student: { Args: Record<string, never>; Returns: boolean };
      // Profile editor saves (012), each all-or-nothing.
      /** The whole ordered photo set; index 0 is the main photo. */
      set_profile_photos: { Args: { p_urls: string[] }; Returns: number };
      set_profile_interests: { Args: { p_interests: string[] }; Returns: number };
      update_housing_and_discovery: {
        Args: {
          p_status: HousingStatus;
          p_discover: DiscoverHousing;
          p_seeking: Seeking;
          p_hide_listings?: boolean;
        };
        Returns: undefined;
      };
      // Checks used by policies, callable by signed-in students (009, 010).
      has_accommodation: { Args: Record<string, never>; Returns: boolean };
      is_verified_student: { Args: Record<string, never>; Returns: boolean };
      is_group_member: { Args: { p_group: string }; Returns: boolean };
      is_group_admin: { Args: { p_group: string }; Returns: boolean };
      is_group_involved: { Args: { p_group: string }; Returns: boolean };
      // Group membership changes (010). Each returns the new status or role.
      request_to_join_group: { Args: { p_group: string }; Returns: GroupMembershipStatus };
      review_join_request: {
        Args: { p_group: string; p_profile: string; p_approve: boolean };
        Returns: GroupMembershipStatus;
      };
      invite_to_group: { Args: { p_group: string; p_profile: string }; Returns: GroupMembershipStatus };
      respond_to_group_invite: { Args: { p_group: string; p_accept: boolean }; Returns: GroupMembershipStatus };
      leave_group: { Args: { p_group: string }; Returns: GroupMembershipStatus };
      remove_group_member: { Args: { p_group: string; p_profile: string }; Returns: GroupMembershipStatus };
      set_group_member_role: {
        Args: { p_group: string; p_profile: string; p_role: GroupRole };
        Returns: GroupRole;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}
