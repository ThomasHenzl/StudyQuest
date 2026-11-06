import { isSupabaseConfigured, supabase } from "./supabase";

export type AppSession = { user: { id: string; email?: string; user_metadata?: { display_name?: string } } };
export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  total_xp: number;
  streak_days: number;
  last_study_date: string | null;
  xp_decay_date: string | null;
};
export type Homework = {
  id: string; title: string; subject: string; description: string;
  difficulty: "Leicht" | "Mittel" | "Schwer"; due_date: string | null;
  completed_at: string | null; created_at: string;
};
export type Grade = {
  id: string; title: string; subject: string; grade: number;
  assessment_type: "test" | "exam"; xp_earned: number; created_at: string;
};
export type StudySession = { id: string; minutes: number; subject: string; created_at: string };
export type XPEvent = { id: string; source_type: string; source_id: string; description: string; xp: number; created_at: string };
export type QuestClaim = { quest_key: string; period_start: string };
export type HomeworkInput = Pick<Homework, "title" | "subject" | "description" | "difficulty" | "due_date">;
export type UserData = {
  profile: Profile;
  homework: Homework[];
  grades: Grade[];
  studySessions: StudySession[];
  events: XPEvent[];
  unlocked: string[];
  questClaims: QuestClaim[];
};

type Account = { id: string; email: string; name: string; salt: string; passwordHash: string };
type LocalDatabase = {
  accounts: Account[];
  currentUserId: string | null;
  users: Record<string, UserData>;
};
const LOCAL_KEY = "studyquest.local.v1";
const EMPTY_DATABASE: LocalDatabase = { accounts: [], currentUserId: null, users: {} };

function readDatabase(): LocalDatabase {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (!raw) return structuredClone(EMPTY_DATABASE);
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !("accounts" in parsed) || !("users" in parsed)) {
    throw new Error("Lokale Kontodaten sind beschädigt. Bitte lösche die StudyQuest-Websitedaten und registriere dich erneut.");
  }
  return parsed as LocalDatabase;
}
function saveDatabase(database: LocalDatabase) { localStorage.setItem(LOCAL_KEY, JSON.stringify(database)); }
function appSession(userData: UserData, email?: string): AppSession {
  return { user: { id: userData.profile.id, email, user_metadata: { display_name: userData.profile.display_name } } };
}
function currentLocalSession(): AppSession | null {
  const database = readDatabase();
  const account = database.accounts.find((item) => item.id === database.currentUserId);
  const userData = account ? database.users[account.id] : undefined;
  return account && userData ? appSession(userData, account.email) : null;
}
function currentUserData(userId: string) {
  const database = readDatabase();
  const userData = database.users[userId];
  if (!userData || database.currentUserId !== userId) throw new Error("Sitzung abgelaufen. Bitte melde dich erneut an.");
  return { database, userData };
}
function isoNow() { return new Date().toISOString(); }
function utcToday() { return new Date().toISOString().slice(0, 10); }
function utcWeekStart() {
  const day = new Date(`${utcToday()}T00:00:00Z`).getUTCDay();
  const date = new Date(`${utcToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function id() { return crypto.randomUUID(); }
function newUserData(userId: string, name: string): UserData {
  return {
    profile: { id: userId, display_name: name, avatar_url: null, total_xp: 0, streak_days: 0, last_study_date: null, xp_decay_date: utcToday() },
    homework: [], grades: [], studySessions: [], events: [], unlocked: [], questClaims: [],
  };
}
function applyLocalDailyXpDecay(userData: UserData) {
  const today = utcToday();
  const lastDecayDate = userData.profile.xp_decay_date;
  if (!lastDecayDate) {
    userData.profile.xp_decay_date = today;
    return;
  }
  if (lastDecayDate >= today) return;
  const lastDateMs = Date.parse(`${lastDecayDate}T00:00:00Z`);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(lastDateMs)) {
    userData.profile.xp_decay_date = today;
    return;
  }
  const elapsedDays = Math.floor((todayMs - lastDateMs) / 86_400_000);
  if (elapsedDays < 1) return;
  userData.profile.total_xp = Math.max(0, userData.profile.total_xp - elapsedDays * 20);
  userData.profile.xp_decay_date = today;
}
function xpForGrade(grade: number, type: "test" | "exam") {
  const rewards = type === "test" ? [200, 150, 100, 50, 0] : [400, 300, 200, 100, 0];
  return rewards[grade - 1] ?? 0;
}
function award(data: UserData, sourceType: string, sourceId: string, description: string, xp: number) {
  if (xp <= 0 || data.events.some((event) => event.source_type === sourceType && event.source_id === sourceId)) return 0;
  data.events.unshift({ id: id(), source_type: sourceType, source_id: sourceId, description, xp, created_at: isoNow() });
  data.profile.total_xp += xp;
  return xp;
}
function periodCount(data: UserData, questKey: string, periodStart: string) {
  const isDaily = questKey.startsWith("daily-");
  const end = new Date(`${periodStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + (isDaily ? 1 : 7));
  const endAt = end.toISOString();
  const inPeriod = (date: string) => date >= `${periodStart}T00:00:00.000Z` && date < endAt;
  if (questKey.endsWith("homework")) return data.homework.filter((item) => item.completed_at && inPeriod(item.completed_at)).length;
  if (questKey.endsWith("study")) return data.studySessions.filter((item) => inPeriod(item.created_at)).reduce((sum, item) => sum + item.minutes, 0);
  return data.grades.filter((item) => inPeriod(item.created_at)).length;
}
const questRules: Record<string, { period: "daily" | "weekly"; goal: number; xp: number }> = {
  "daily-homework": { period: "daily", goal: 1, xp: 40 },
  "daily-study": { period: "daily", goal: 30, xp: 30 },
  "weekly-homework": { period: "weekly", goal: 5, xp: 120 },
  "weekly-study": { period: "weekly", goal: 120, xp: 100 },
  "weekly-grades": { period: "weekly", goal: 3, xp: 80 },
};

async function passwordHash(password: string, salt: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 150_000, hash: "SHA-256" }, key, 256);
  return Array.from(new Uint8Array(bits), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export const isLocalMode = !isSupabaseConfigured;
export function getInitialAuthMode(): "login" | "register" {
  return isLocalMode && readDatabase().accounts.length === 0 ? "register" : "login";
}
const authListeners = new Set<(session: AppSession | null) => void>();
function notifyLocalAuth() {
  const session = currentLocalSession();
  authListeners.forEach((listener) => listener(session));
}

export async function getAppSession(): Promise<AppSession | null> {
  if (!isLocalMode) {
    const { data, error } = await supabase!.auth.getSession();
    if (error) throw error;
    return data.session as AppSession | null;
  }
  return currentLocalSession();
}
export function subscribeToAuth(listener: (session: AppSession | null) => void) {
  if (!isLocalMode) {
    const { data: { subscription } } = supabase!.auth.onAuthStateChange((_event, session) => listener(session as AppSession | null));
    return () => subscription.unsubscribe();
  }
  authListeners.add(listener);
  return () => { authListeners.delete(listener); };
}
export async function register(email: string, password: string, name: string) {
  if (!isLocalMode) {
    const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
    const { data, error } = await supabase!.auth.signUp({
      email,
      password,
      options: { data: { display_name: name }, emailRedirectTo },
    });
    if (error) throw error;
    return { emailConfirmationRequired: !data.session };
  }
  const normalizedEmail = email.trim().toLowerCase();
  const database = readDatabase();
  if (database.accounts.some((account) => account.email === normalizedEmail)) throw new Error("Für diese E-Mail-Adresse gibt es bereits ein Konto.");
  const userId = id();
  const salt = id();
  const account: Account = { id: userId, email: normalizedEmail, name: name.trim(), salt, passwordHash: await passwordHash(password, salt) };
  database.accounts.push(account);
  database.users[userId] = newUserData(userId, account.name);
  database.currentUserId = userId;
  saveDatabase(database);
  notifyLocalAuth();
  return { emailConfirmationRequired: false };
}
export async function resendSignupConfirmation(email: string) {
  if (isLocalMode) throw new Error("E-Mail-Bestätigung ist im lokalen Testmodus nicht verfügbar.");
  const emailRedirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabase!.auth.resend({
    type: "signup",
    email: email.trim(),
    options: { emailRedirectTo },
  });
  if (error) throw error;
}
export async function signIn(email: string, password: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
    return;
  }
  const database = readDatabase();
  const account = database.accounts.find((item) => item.email === email.trim().toLowerCase());
  if (!account || !secureEqual(await passwordHash(password, account.salt), account.passwordHash)) {
    throw new Error("E-Mail-Adresse oder Passwort ist falsch.");
  }
  database.currentUserId = account.id;
  saveDatabase(database);
  notifyLocalAuth();
}
export async function signOut() {
  if (!isLocalMode) {
    const { error } = await supabase!.auth.signOut();
    if (error) throw error;
    return;
  }
  const database = readDatabase();
  database.currentUserId = null;
  saveDatabase(database);
  notifyLocalAuth();
}

export async function loadUserData(userId: string): Promise<UserData> {
  if (!isLocalMode) {
    const { error: decayError } = await supabase!.rpc("apply_daily_xp_decay");
    if (decayError) throw decayError;
    const results = await Promise.all([
      supabase!.from("profiles").select("*").eq("id", userId).single(),
      supabase!.from("homework").select("*").eq("user_id", userId).order("due_date", { ascending: true, nullsFirst: false }),
      supabase!.from("grades").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase!.from("study_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase!.from("xp_events").select("*").eq("user_id", userId).order("created_at", { ascending: false }),
      supabase!.from("achievement_unlocks").select("achievement_key").eq("user_id", userId),
      supabase!.from("quest_claims").select("quest_key, period_start").eq("user_id", userId),
    ]);
    const failure = results.find((result) => result.error);
    if (failure?.error) throw failure.error;
    return {
      profile: results[0].data as Profile,
      homework: (results[1].data ?? []) as Homework[],
      grades: (results[2].data ?? []) as Grade[],
      studySessions: (results[3].data ?? []) as StudySession[],
      events: (results[4].data ?? []) as XPEvent[],
      unlocked: ((results[5].data ?? []) as { achievement_key: string }[]).map((item) => item.achievement_key),
      questClaims: (results[6].data ?? []) as QuestClaim[],
    };
  }
  const { database, userData } = currentUserData(userId);
  applyLocalDailyXpDecay(userData);
  saveDatabase(database);
  return structuredClone(userData);
}

export async function saveProfile(userId: string, values: { display_name: string; avatar_url: string | null }) {
  if (!isLocalMode) {
    const { error } = await supabase!.from("profiles").update(values).eq("id", userId);
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  userData.profile = { ...userData.profile, ...values };
  const account = database.accounts.find((item) => item.id === userId);
  if (account) account.name = values.display_name;
  saveDatabase(database);
}
export async function createHomework(userId: string, values: HomeworkInput) {
  if (!isLocalMode) {
    const { error } = await supabase!.from("homework").insert({ ...values, user_id: userId });
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  userData.homework.push({ ...values, id: id(), completed_at: null, created_at: isoNow() });
  saveDatabase(database);
}
export async function updateHomework(userId: string, homeworkId: string, values: HomeworkInput) {
  if (!isLocalMode) {
    const { error } = await supabase!.from("homework").update(values).eq("id", homeworkId).eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  const task = userData.homework.find((item) => item.id === homeworkId);
  if (!task) throw new Error("Hausaufgabe nicht gefunden.");
  Object.assign(task, values);
  saveDatabase(database);
}
export async function deleteHomework(userId: string, homeworkId: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.from("homework").delete().eq("id", homeworkId).eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  userData.homework = userData.homework.filter((item) => item.id !== homeworkId);
  saveDatabase(database);
}
export async function completeHomework(userId: string, homeworkId: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.rpc("complete_homework", { p_homework_id: homeworkId });
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  const task = userData.homework.find((item) => item.id === homeworkId);
  if (!task) throw new Error("Hausaufgabe nicht gefunden.");
  if (!task.completed_at) {
    task.completed_at = isoNow();
    award(userData, "homework", homeworkId, "Hausaufgabe abgeschlossen", 50);
  }
  saveDatabase(database);
}
export async function recordStudySession(userId: string, minutes: number, subject: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.rpc("record_study_session", { p_minutes: minutes, p_subject: subject });
    if (error) throw error;
    return;
  }
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new Error("Lernzeit muss zwischen 1 und 600 Minuten liegen.");
  const { database, userData } = currentUserData(userId);
  const session = { id: id(), minutes, subject, created_at: isoNow() };
  userData.studySessions.unshift(session);
  award(userData, "study", session.id, `${minutes} Minuten gelernt`, minutes);
  const today = utcToday();
  const previous = userData.profile.last_study_date;
  if (previous !== today) {
    userData.profile.streak_days = previous === new Date(Date.now() - 86400000).toISOString().slice(0, 10)
      ? userData.profile.streak_days + 1
      : 1;
    userData.profile.last_study_date = today;
  }
  saveDatabase(database);
}
export async function submitGrade(userId: string, title: string, subject: string, grade: number, assessmentType: "test" | "exam") {
  if (!isLocalMode) {
    const { error } = await supabase!.rpc("submit_grade", {
      p_title: title, p_subject: subject, p_grade: grade, p_assessment_type: assessmentType,
    });
    if (error) throw error;
    return;
  }
  if (!Number.isInteger(grade) || grade < 1 || grade > 5) throw new Error("Note muss zwischen 1 und 5 liegen.");
  const { database, userData } = currentUserData(userId);
  const earned = xpForGrade(grade, assessmentType);
  const entry: Grade = { id: id(), title, subject, grade, assessment_type: assessmentType, xp_earned: earned, created_at: isoNow() };
  userData.grades.unshift(entry);
  if (earned > 0) award(userData, "grade", entry.id, `Note ${grade} eingetragen`, earned);
  saveDatabase(database);
}
export async function claimQuest(userId: string, questKey: string, periodStart: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.rpc("claim_quest", { p_quest_key: questKey, p_period_start: periodStart });
    if (error) throw error;
    return;
  }
  const rule = questRules[questKey];
  if (!rule) throw new Error("Quest nicht gefunden.");
  const currentPeriod = rule.period === "daily" ? utcToday() : utcWeekStart();
  if (periodStart !== currentPeriod) throw new Error("Quest-Zeitraum ist abgelaufen.");
  const { database, userData } = currentUserData(userId);
  if (periodCount(userData, questKey, periodStart) < rule.goal) throw new Error("Quest-Anforderung noch nicht erfüllt.");
  if (userData.questClaims.some((claim) => claim.quest_key === questKey && claim.period_start === periodStart)) {
    throw new Error("Diese Quest-Belohnung hast du bereits abgeholt.");
  }
  userData.questClaims.push({ quest_key: questKey, period_start: periodStart });
  award(userData, "quest", `${questKey}:${periodStart}`, "Quest abgeschlossen", rule.xp);
  saveDatabase(database);
}
export async function unlockAchievement(userId: string, achievementKey: string) {
  if (!isLocalMode) {
    const { error } = await supabase!.rpc("unlock_achievement", { p_achievement_key: achievementKey });
    if (error) throw error;
    return;
  }
  const { database, userData } = currentUserData(userId);
  const rules: Record<string, { xp: number; eligible: boolean }> = {
    "first-homework": { xp: 50, eligible: userData.homework.some((item) => item.completed_at !== null) },
    "study-five-hours": { xp: 100, eligible: userData.studySessions.reduce((sum, item) => sum + item.minutes, 0) >= 300 },
    "five-grades": { xp: 75, eligible: userData.grades.length >= 5 },
    "week-streak": {
      xp: 150,
      eligible: userData.profile.streak_days >= 7 && Boolean(userData.profile.last_study_date && userData.profile.last_study_date >= new Date(Date.now() - 86400000).toISOString().slice(0, 10)),
    },
  };
  const rule = rules[achievementKey];
  if (!rule) throw new Error("Achievement nicht gefunden.");
  if (!rule.eligible) throw new Error("Achievement noch nicht freigeschaltet.");
  if (userData.unlocked.includes(achievementKey)) throw new Error("Dieses Achievement hast du bereits abgeholt.");
  userData.unlocked.push(achievementKey);
  award(userData, "achievement", achievementKey, "Achievement freigeschaltet", rule.xp);
  saveDatabase(database);
}

export function sessionEmail(session: AppSession) { return session.user.email ?? ""; }
