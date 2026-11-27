/**
 * TypeScript shapes of the database, matching
 * `supabase/migrations/` (001 to 016) exactly. Keep the two in sync: every
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
  /** True exactly when status is 'active' (014). Read-only for students. */
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
  // --- Added in 014 ---
  /** draft (never published), active (live) or inactive (deactivated). */
  status: ListingStatus;
  /** Area or locality, e.g. "Near the Arch gate". Public. */
  locality: string | null;
  /** Nearby landmarks or directions, without the exact address. Public. */
  location_notes: string | null;
  /** The spot on offer: a room of their own, or a shared room. */
  room_type: ListingRoomType | null;
  furnishing: Furnishing | null;
  house_rules: string | null;
  /** The current living arrangement and vibe. */
  living_arrangement: string | null;
}

export type ListingStatus = "draft" | "active" | "inactive";
export type ListingRoomType = "private" | "shared";
export type Furnishing = "furnished" | "semi_furnished" | "unfurnished";

/** The exact address of a listing (014): readable by its owner only. */
export type ListingPrivateDetailsRow = {
  listing_id: string;
  address: string | null;
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
  /** The listing a like was about (014); null if none or since deleted. */
  liked_listing_id: string | null;
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

/** One student blocking another (013). Readable only by the blocker. */
export type BlockRow = {
  blocker_id: string;
  blocked_id: string;
  created_at: string;
}

/** A row from discovery_candidates() (013). */
export type DiscoveryCandidateRow = {
  candidate_id: string;
  housing: HousingStatus;
  seeking: Seeking;
  /** Their live listing, if they have a place and one is live. */
  listing_id: string | null;
  last_active: string;
  lifestyle: Partial<Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at">> | null;
  interests: string[];
  /**
   * How they compare with the viewer's private practical preferences:
   * "match" | "close" | "mismatch" (amenities: share 0-1). Keys are
   * missing when either side hasn't said.
   */
  facts: Partial<Record<"budget" | "societies" | "move_in" | "room_type" | "bhk" | "gender", "match" | "close" | "mismatch">> & {
    amenities?: number;
  };
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
  // --- Added in 015 ---
  /** With budget_max, the group's budget range per person. */
  budget_min: number | null;
  /** Whether the group already has a place or is looking for one. */
  housing_status: HousingStatus | null;
  room_preference: RoomType | null;
  /** Lifestyle the group expects, in its own words. */
  lifestyle_notes: string | null;
}

export type GroupEventKind =
  | "created"
  | "invited"
  | "invite_accepted"
  | "invite_declined"
  | "invite_cancelled"
  | "requested"
  | "request_approved"
  | "request_declined"
  | "request_withdrawn"
  | "member_left"
  | "member_removed"
  | "role_changed";

/** A membership change, recorded by the database (015). */
export type GroupEventRow = {
  id: string;
  group_id: string;
  group_name: string;
  subject_id: string | null;
  actor_id: string | null;
  kind: GroupEventKind;
  /**
   * The invitation or request message (kept only while it's pending, 017),
   * or the new role.
   */
  detail: string | null;
  created_at: string;
}

/** Someone to tell about a group event (015). Only read_at is writable. */
export type NotificationRow = {
  id: string;
  recipient_id: string;
  event_id: string;
  read_at: string | null;
  created_at: string;
}

export type GroupSystemKind = "joined" | "left" | "removed" | "made_admin" | "removed_admin";

/**
 * A message in a group's chat (016). User messages have a sender and
 * content; system messages ("X joined") have a kind, a subject and an actor
 * and are written by the database only. Immutable.
 */
export type GroupMessageRow = {
  id: string;
  group_id: string;
  /** Null for system messages, and after a sender deletes their account. */
  sender_id: string | null;
  message_type: "user" | "system";
  content: string | null;
  system_kind: GroupSystemKind | null;
  subject_id: string | null;
  actor_id: string | null;
  event_id: string | null;
  /** Always set by the database. */
  created_at: string;
}

/** Where a member has read a group's chat up to (016). Changed only by mark_group_chat_read(). */
export type GroupChatReadRow = {
  group_id: string;
  profile_id: string;
  last_read_at: string;
  updated_at: string;
}

/** A row from group_chat_summaries() (016): one per group you're in. */
export type GroupChatSummaryRow = {
  group_id: string;
  /** Other people's ordinary messages since you last read (stops at 100). */
  unread_count: number;
  last_id: string | null;
  last_at: string | null;
  last_type: "user" | "system" | null;
  last_content: string | null;
  last_sender_id: string | null;
  last_system_kind: GroupSystemKind | null;
  last_subject_id: string | null;
  last_actor_id: string | null;
}

/** A row from discover_groups() (015). */
export type DiscoverGroupRow = {
  group_id: string;
  member_count: number;
  /** The viewer's membership status, if any. */
  my_status: GroupMembershipStatus | null;
}

/** A row from search_students_for_group() (015): public fields only. */
export type GroupInviteCandidate = {
  profile_id: string;
  full_name: string | null;
  avatar_url: string | null;
  department: string | null;
  year_of_study: number | null;
  about: string | null;
  membership: GroupMembershipStatus | null;
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
  /**
   * The note sent with an invitation or join request (015). Kept only while
   * the row is pending, and not readable by students directly: use
   * group_membership_notes() (017).
   */
  message: string | null;
}

/** A row from group_membership_notes() (017). */
export type GroupMembershipNoteRow = {
  group_id: string;
  profile_id: string;
  status: "invited" | "requested";
  message: string;
};

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

/**
 * The listing fields a student may write (009, 014): never id, owner,
 * times, or status (that goes through set_listing_status()).
 */
type ListingWritable = Omit<ListingRow, "id" | "owner_id" | "created_at" | "updated_at" | "status" | "is_active">;
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
      | "budget_min"
      | "housing_status"
      | "room_preference"
      | "lifestyle_notes"
    >
  >;
/** Admins only. */
type GroupUpdate = Partial<Omit<GroupRow, "id" | "created_by" | Generated>>;

type SwipeInsert = Pick<SwipeRow, "sender_id" | "receiver_id" | "action"> &
  Partial<
    Pick<SwipeRow, "liked_target_type" | "liked_target_ref" | "comment" | "liked_listing_id">
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
      listing_private_details: {
        Row: ListingPrivateDetailsRow;
        Insert: Pick<ListingPrivateDetailsRow, "listing_id" | "address">;
        Update: Pick<ListingPrivateDetailsRow, "address">;
        Relationships: Relationship[];
      };
      blocks: {
        Row: BlockRow;
        Insert: Pick<BlockRow, "blocker_id" | "blocked_id">;
        Update: never;
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
      group_events: {
        Row: GroupEventRow;
        /** Written by the database only. */
        Insert: never;
        Update: never;
        Relationships: Relationship[];
      };
      notifications: {
        Row: NotificationRow;
        Insert: never;
        /** Marking as read only. */
        Update: Pick<NotificationRow, "read_at">;
        Relationships: Relationship[];
      };
      group_messages: {
        Row: GroupMessageRow;
        /** Ordinary messages only; the time and type come from the database. */
        Insert: Pick<GroupMessageRow, "group_id" | "sender_id" | "content"> & Partial<Pick<GroupMessageRow, "id">>;
        /** Messages are immutable. */
        Update: never;
        Relationships: Relationship[];
      };
      group_chat_reads: {
        Row: GroupChatReadRow;
        /** Only through mark_group_chat_read(). */
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
      /**
       * Who may appear in the signed-in student's feed (013): eligibility,
       * their discovery preference, blocks, past decisions and filters.
       */
      discovery_candidates: {
        Args: { p_filters?: Record<string, unknown>; p_exclude?: string[]; p_limit?: number };
        Returns: DiscoveryCandidateRow[];
      };
      /**
       * Publish ('active') or deactivate ('inactive') your listing (014).
       * Returns the new status, or 'conflict' when another listing is live
       * and p_replace doesn't name it (then nothing changes).
       */
      set_listing_status: {
        Args: { p_listing: string; p_status: "active" | "inactive"; p_replace?: string | null };
        Returns: "active" | "inactive" | "conflict";
      };
      // Checks used by policies, callable by signed-in students (009, 010).
      has_accommodation: { Args: Record<string, never>; Returns: boolean };
      is_verified_student: { Args: Record<string, never>; Returns: boolean };
      is_group_member: { Args: { p_group: string }; Returns: boolean };
      is_group_admin: { Args: { p_group: string }; Returns: boolean };
      is_group_involved: { Args: { p_group: string }; Returns: boolean };
      // Group membership changes (010). Each returns the new status or role.
      request_to_join_group: { Args: { p_group: string; p_message?: string | null }; Returns: GroupMembershipStatus };
      review_join_request: {
        Args: { p_group: string; p_profile: string; p_approve: boolean };
        Returns: GroupMembershipStatus;
      };
      invite_to_group: {
        Args: { p_group: string; p_profile: string; p_message?: string | null };
        Returns: GroupMembershipStatus;
      };
      /** Withdraw an unanswered invitation (015). */
      cancel_group_invite: { Args: { p_group: string; p_profile: string }; Returns: GroupMembershipStatus };
      /** Eligible students an admin may invite (015). */
      search_students_for_group: {
        Args: { p_group: string; p_query: string; p_limit?: number };
        Returns: GroupInviteCandidate[];
      };
      /**
       * "I've read this group's chat up to here" (016). Never moves back.
       * Active members only.
       */
      mark_group_chat_read: {
        Args: { p_group: string; p_up_to?: string | null };
        Returns: string;
      };
      /** Unread count and newest message for each group you're in (016). */
      group_chat_summaries: {
        Args: Record<string, never>;
        Returns: GroupChatSummaryRow[];
      };
      /**
       * Is this group message hidden from you by a block, either way (016)?
       * Used by the read policy; true only for an eligible student in a
       * group they're active in.
       */
      group_message_blocked: { Args: { p_message: string }; Returns: boolean };
      /** Pending invitation / request notes you may read in these groups (017). */
      group_membership_notes: { Args: { p_groups: string[] }; Returns: GroupMembershipNoteRow[] };
      /** Discoverable groups for the signed-in student (015). */
      discover_groups: {
        Args: { p_filters?: Record<string, unknown>; p_limit?: number };
        Returns: DiscoverGroupRow[];
      };
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
