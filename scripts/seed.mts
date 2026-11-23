/**
 * Sample students for testing and demos.
 *
 *   npm run seed     create (or refresh) 6 sample students and their flats
 *   npm run unseed   delete them again, with everything they're part of
 *
 * Every sample student is invented and is labelled "Sample profile" in the
 * app (profiles.is_sample, migration 005). Run `npm run unseed` before real
 * students arrive.
 *
 * Needs, in .env.local (never commit it, never put it on Vercel):
 *   SUPABASE_SERVICE_ROLE_KEY=...   Supabase > Project Settings > API Keys:
 *                                    the "secret" key (sb_secret_...) or the
 *                                    legacy "service_role" key.
 * It bypasses all security, so it's used only by this script on your
 * computer, never by the app.
 *
 * Safe to run repeatedly: existing sample students are updated, not doubled.
 */
import { createClient, type User } from "@supabase/supabase-js";

import type {
  BioPrompt,
  Gender,
  LifestylePreferencesRow,
  ListingRow,
  MoveInTimeframe,
  Society,
} from "../src/types/database";

/**
 * Sample accounts live on a reserved test domain (.test can never be a real
 * inbox), so they can never collide with a real @srmist.edu.in student.
 */
const SEED_DOMAIN = "seed.roomie.test";

type Flat = Pick<
  ListingRow,
  | "society"
  | "bhk_type"
  | "vacant_spots"
  | "rent_per_person"
  | "maintenance_per_person"
  | "deposit_per_person"
  | "setup_cost"
  | "amenities"
  | "photos"
> &
  Partial<Pick<ListingRow, "description" | "current_flatmates">>;

type Lifestyle = Partial<Omit<LifestylePreferencesRow, "profile_id" | "created_at" | "updated_at">>;

type SampleStudent = {
  /** Becomes the email: <handle>@seed.roomie.test */
  handle: string;
  fullName: string;
  gender: Gender;
  year: number;
  department: string;
  avatar: string;
  prompts: BioPrompt[];
} & (
  | { mode: "have_flat"; flat: Flat }
  | {
      mode: "need_flat";
      looking: { societies: Society[]; budget: number; moveIn: MoveInTimeframe };
    }
);

const STUDENTS: SampleStudent[] = [
  {
    handle: "aarav.sharma",
    fullName: "Aarav Sharma",
    gender: "male",
    year: 3,
    department: "CSE",
    avatar: "/seed/avatar-aarav.svg",
    prompts: [
      {
        question: "Our flat's current vibe & house rules...",
        answer:
          "Two CSE seniors, calm on weekdays. Cook comes at 7:30, dishes done the same night, quiet after 11 during exams.",
      },
      {
        question: "Non-negotiable shared expense rule...",
        answer: "Rent, Wi-Fi and cook split equally on Splitwise and settled by the 5th. No awkward reminders.",
      },
      {
        question: "Late-night food run? I'm heading to...",
        answer: "Potheri for Maggi and chai, or Java canteen if it's still open. Always up for company.",
      },
    ],
    mode: "have_flat",
    flat: {
      society: "Abode Valley",
      bhk_type: "3BHK",
      vacant_spots: 1,
      rent_per_person: 11500,
      maintenance_per_person: 1500,
      deposit_per_person: 25000,
      setup_cost: 0,
      amenities: ["AC", "Wi-Fi", "Cook", "Maid", "No Owner Interference"],
      photos: ["/seed/flat-abode-living.svg", "/seed/flat-abode-bedroom.svg"],
      description: "Bright 3BHK with a quiet room free, ten minutes from the Arch gate.",
      current_flatmates: 2,
    },
  },
  {
    handle: "diya.nair",
    fullName: "Diya Nair",
    gender: "female",
    year: 4,
    department: "Biotech",
    avatar: "/seed/avatar-diya.svg",
    prompts: [
      {
        question: "Our flat's current vibe & house rules...",
        answer:
          "Two of us, lots of plants and a balcony we actually use. Shoes off inside, friends welcome till 10 PM.",
      },
      {
        question: "My cleaning style, honestly...",
        answer: "Kitchen clean before bed, always. There's a weekly chore chart on the fridge and it works.",
      },
      {
        question: "Ideal weekend vibe in Potheri / KTR...",
        answer: "Sunrise at Besant Nagar, a slow brunch, then a lab report marathon with filter coffee.",
      },
    ],
    mode: "have_flat",
    flat: {
      society: "Estancia",
      bhk_type: "3BHK",
      vacant_spots: 1,
      rent_per_person: 14000,
      maintenance_per_person: 2000,
      deposit_per_person: 30000,
      setup_cost: 0,
      amenities: ["AC", "Washing Machine", "Power Backup", "Balcony"],
      photos: ["/seed/flat-estancia-bedroom.svg", "/seed/flat-estancia-balcony.svg"],
      description: "Calm 3BHK with a balcony full of plants. One room free.",
      current_flatmates: 2,
    },
  },
  {
    handle: "rohan.verma",
    fullName: "Rohan Verma",
    gender: "male",
    year: 2,
    department: "ECE",
    avatar: "/seed/avatar-rohan.svg",
    prompts: [
      {
        question: "Our flat's current vibe & house rules...",
        answer:
          "Chill 2BHK with a gaming setup in the hall. The owner never interferes; we just keep it clean.",
      },
      {
        question: "When the power goes out, I...",
        answer: "Switch to the inverter, light a candle and finish my circuits assignment on a power bank.",
      },
      {
        question: "Before an 8 AM class, I'm...",
        answer: "Up at 7:15, quick chai, shared auto to the Arch gate. Bathroom timings sorted, no fights.",
      },
    ],
    mode: "have_flat",
    flat: {
      society: "Akshaya",
      bhk_type: "2BHK",
      vacant_spots: 1,
      rent_per_person: 8500,
      maintenance_per_person: 1000,
      deposit_per_person: 15000,
      setup_cost: 0,
      amenities: ["Wi-Fi", "Geyser", "Bachelor Friendly"],
      photos: ["/seed/flat-akshaya-bedroom.svg", "/seed/flat-akshaya-living.svg"],
      description: "Easy-going 2BHK, gaming setup in the hall, owner never visits.",
      current_flatmates: 1,
    },
  },
  {
    handle: "ananya.iyer",
    fullName: "Ananya Iyer",
    gender: "female",
    year: 2,
    department: "CSE",
    avatar: "/seed/avatar-ananya.svg",
    prompts: [
      {
        question: "My sleep & study schedule during end-sems...",
        answer:
          "Library at Tech Park till 9, home by 10, lights off by 1. I need a quiet room, not silence everywhere.",
      },
      {
        question: "My biggest flatmate dealbreaker is...",
        answer: "A sink full of dishes for days, or loud calls at 2 AM. Everything else we can talk about.",
      },
      {
        question: "You'll catch me ordering from...",
        answer: "Instamart for midnight snacks and biryani every Friday. I will share.",
      },
    ],
    mode: "need_flat",
    looking: { societies: ["Estancia", "Abode Valley"], budget: 15000, moveIn: "next_month" },
  },
  {
    handle: "karthik.menon",
    fullName: "Karthik Menon",
    gender: "male",
    year: 3,
    department: "Mechanical",
    avatar: "/seed/avatar-karthik.svg",
    prompts: [
      {
        question: "Ideal weekend vibe in Potheri / KTR...",
        answer: "Football on Saturday morning, a long nap, then cooking a proper home-style meal on Sunday.",
      },
      {
        question: "Guest / friends hanging out policy...",
        answer: "Match nights with friends are great. Overnight guests only if everyone agrees first.",
      },
      {
        question: "The best flatmate I could ask for...",
        answer: "Pays on time, swaps the gas cylinder without drama and is up for a midnight walk.",
      },
    ],
    mode: "need_flat",
    looking: {
      societies: ["Abode Valley", "Potheri Independent"],
      budget: 10000,
      moveIn: "immediate",
    },
  },
  {
    handle: "sneha.reddy",
    fullName: "Sneha Reddy",
    gender: "female",
    year: 1,
    department: "MBA",
    avatar: "/seed/avatar-sneha.svg",
    prompts: [
      {
        question: "Before an 8 AM class, I'm...",
        answer: "Done with yoga and making coffee. Morning person, but I keep it quiet for the night owls.",
      },
      {
        question: "Non-negotiable shared expense rule...",
        answer: "Groceries split weekly with receipts on the group chat. Simple and fair.",
      },
      {
        question: "My cleaning style, honestly...",
        answer: "Tidy, not obsessive. Common areas stay clean; my room is my business.",
      },
    ],
    mode: "need_flat",
    looking: { societies: ["Green Pearl", "Estancia"], budget: 13000, moveIn: "july" },
  },
];

/** Lifestyle answers and interests (migration 008), by handle. */
const DETAILS: Record<string, { lifestyle: Lifestyle; interests: string[] }> = {
  "aarav.sharma": {
    lifestyle: {
      sleep_schedule: "night_owl", cleanliness: "tidy", social_life: "balanced",
      study_habits: "home_with_music", guests: "sometimes", noise_tolerance: "medium",
      smoking: "non_smoker", food_habits: "non_vegetarian", personality: "ambivert",
    },
    interests: ["coding", "cricket", "gaming"],
  },
  "diya.nair": {
    lifestyle: {
      sleep_schedule: "early_bird", cleanliness: "very_tidy", social_life: "homebody",
      study_habits: "quiet_at_home", guests: "rarely", noise_tolerance: "low",
      smoking: "non_smoker", food_habits: "vegetarian", personality: "introvert",
    },
    interests: ["reading", "cooking", "yoga"],
  },
  "rohan.verma": {
    lifestyle: {
      sleep_schedule: "night_owl", cleanliness: "relaxed", social_life: "outgoing",
      study_habits: "varies", guests: "often", noise_tolerance: "high",
      smoking: "non_smoker", food_habits: "non_vegetarian", personality: "extrovert",
    },
    interests: ["gaming", "football", "music"],
  },
  "ananya.iyer": {
    lifestyle: {
      sleep_schedule: "flexible", cleanliness: "very_tidy", social_life: "balanced",
      study_habits: "library", guests: "rarely", noise_tolerance: "low",
      smoking: "non_smoker", food_habits: "vegetarian", personality: "ambivert",
    },
    interests: ["coding", "hackathons", "movies"],
  },
  "karthik.menon": {
    lifestyle: {
      sleep_schedule: "early_bird", cleanliness: "tidy", social_life: "outgoing",
      study_habits: "home_with_music", guests: "sometimes", noise_tolerance: "medium",
      smoking: "non_smoker", food_habits: "non_vegetarian", personality: "extrovert",
    },
    interests: ["football", "cooking", "gym"],
  },
  "sneha.reddy": {
    lifestyle: {
      sleep_schedule: "early_bird", cleanliness: "tidy", social_life: "balanced",
      study_habits: "quiet_at_home", guests: "rarely", noise_tolerance: "low",
      smoking: "non_smoker", food_habits: "eggetarian", personality: "ambivert",
    },
    interests: ["yoga", "startups", "travel"],
  },
};

// --- Setup ---------------------------------------------------------------------

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error(
    [
      "Missing settings in .env.local:",
      !url ? "  NEXT_PUBLIC_SUPABASE_URL (your project URL)" : "",
      !serviceKey
        ? "  SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API Keys > secret key)"
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  process.exit(1);
}
if (serviceKey.startsWith("sb_publishable_")) {
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY is the publishable key. Use the secret key (sb_secret_...) instead.",
  );
  process.exit(1);
}

// Untyped on purpose: this script sets database-only fields (is_sample,
// is_srm_verified) that the app's types rightly forbid.
const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isSampleAccount(user: User): boolean {
  // Both marks must match, so a real account can never be touched.
  return user.app_metadata?.roomie_seed === true && (user.email ?? "").endsWith(`@${SEED_DOMAIN}`);
}

async function findSampleAccounts(): Promise<User[]> {
  const found: User[] = [];
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw new Error(`Couldn't list accounts: ${error.message}`);
    }
    found.push(...data.users.filter(isSampleAccount));
    if (data.users.length < perPage) {
      return found;
    }
  }
}

// --- Seed --------------------------------------------------------------------------

async function seed() {
  const existing = new Map((await findSampleAccounts()).map((user) => [user.email, user.id]));
  console.log(`Seeding ${STUDENTS.length} sample students...`);

  for (const student of STUDENTS) {
    const email = `${student.handle}@${SEED_DOMAIN}`;
    let id = existing.get(email);
    if (!id) {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        // Nobody ever signs in as a sample student.
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { full_name: student.fullName },
        app_metadata: { roomie_seed: true },
      });
      if (error) {
        throw new Error(`Couldn't create ${student.fullName}: ${error.message}`);
      }
      id = data.user.id;
    }

    // The signup trigger made the profile row; fill it in.
    const { error: profileError } = await supabase
      .from("profiles")
      .update({
        full_name: student.fullName,
        gender: student.gender,
        year_of_study: student.year,
        department: student.department,
        mode: student.mode,
        avatar_url: student.avatar,
        bio_prompts: student.prompts,
        preferred_societies: student.mode === "need_flat" ? student.looking.societies : [],
        max_budget: student.mode === "need_flat" ? student.looking.budget : null,
        move_in_timeframe: student.mode === "need_flat" ? student.looking.moveIn : null,
        is_srm_verified: true,
        is_sample: true,
      })
      .eq("id", id);
    if (profileError) {
      const hint = profileError.message.includes("is_sample")
        ? " Run supabase/migrations/005_sample_profiles.sql in the SQL Editor first."
        : "";
      throw new Error(`Couldn't save ${student.fullName}'s profile: ${profileError.message}.${hint}`);
    }

    if (student.mode === "have_flat") {
      // Update their listing if it exists, otherwise create it.
      const { data: current } = await supabase
        .from("listings")
        .select("id")
        .eq("owner_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const flat = { ...student.flat, is_active: true };
      const { error } = current
        ? await supabase.from("listings").update(flat).eq("id", current.id)
        : await supabase.from("listings").insert({ owner_id: id, ...flat });
      if (error) {
        throw new Error(`Couldn't save ${student.fullName}'s flat: ${error.message}`);
      }
    } else {
      await supabase.from("listings").delete().eq("owner_id", id);
    }

    // Lifestyle answers and interests.
    const details = DETAILS[student.handle];
    const { error: lifestyleError } = await supabase
      .from("lifestyle_preferences")
      .upsert({ profile_id: id, ...details.lifestyle }, { onConflict: "profile_id" });
    await supabase.from("profile_interests").delete().eq("profile_id", id);
    const { error: interestsError } = await supabase
      .from("profile_interests")
      .insert(details.interests.map((interest) => ({ profile_id: id, interest })));
    const detailsError = lifestyleError ?? interestsError;
    if (detailsError) {
      throw new Error(
        `Couldn't save ${student.fullName}'s lifestyle and interests: ${detailsError.message}. Run migrations 006 to 010 first.`,
      );
    }

    const summary =
      student.mode === "have_flat"
        ? `${student.flat.society}, ${student.flat.bhk_type}`
        : `looking in ${student.looking.societies.join(" / ")}`;
    console.log(`  ${existing.has(email) ? "updated" : "created"}  ${student.fullName} (${summary})`);
  }

  console.log(
    "\nDone. They appear in Discover with a \"Sample profile\" label.\nRemove them before launch with: npm run unseed",
  );
}

// --- Unseed ------------------------------------------------------------------------

async function unseed() {
  const accounts = await findSampleAccounts();
  if (accounts.length === 0) {
    console.log("No sample students found. Nothing to remove.");
    return;
  }
  console.log(`Removing ${accounts.length} sample students...`);
  for (const account of accounts) {
    // Deleting the account also deletes their profile, flat, likes,
    // matches and messages (the tables cascade).
    const { error } = await supabase.auth.admin.deleteUser(account.id);
    if (error) {
      throw new Error(`Couldn't remove ${account.email}: ${error.message}`);
    }
    console.log(`  removed  ${account.email}`);
  }
  console.log("\nDone. Only real accounts are left.");
}

try {
  await (process.argv.includes("--remove") ? unseed() : seed());
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
