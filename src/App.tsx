import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Activity, Award, BookOpen, CalendarDays, Check,
  CheckCircle2, ChevronRight, CircleHelp, Clock3, Flame, GraduationCap, House,
  LogOut, Menu, Pause, Pencil, Play, Plus, RotateCcw, ScrollText, ShieldCheck,
  Sparkles, Star, Target, Trophy, X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  claimQuest as claimQuestReward, completeHomework as completeHomeworkReward, createHomework,
  deleteHomework, getAppSession, getInitialAuthMode, isLocalMode, loadUserData, recordStudySession,
  register, saveProfile as saveUserProfile, signIn, signOut, subscribeToAuth,
  resendSignupConfirmation,
  submitGrade, unlockAchievement as unlockAchievementReward, updateHomework,
  type AppSession, type Grade, type Homework, type Profile, type StudySession, type XPEvent,
} from "./lib/backend";
type NavPage = "Dashboard" | "Aufgaben" | "Noten" | "Statistiken" | "Ränge" | "Erfolge";
type Quest = { key: string; title: string; detail: string; goal: number; xp: number; period: "daily" | "weekly"; icon: typeof BookOpen };

const navigation: { name: NavPage; icon: typeof House }[] = [
  { name: "Dashboard", icon: House }, { name: "Aufgaben", icon: ScrollText },
  { name: "Noten", icon: GraduationCap }, { name: "Statistiken", icon: Activity },
  { name: "Ränge", icon: ShieldCheck }, { name: "Erfolge", icon: Trophy },
];
const rankTiers = [
  { name: "Anfänger", minLevel: 1, maxLevel: 5 },
  { name: "Bronze", minLevel: 6, maxLevel: 10 },
  { name: "Silber", minLevel: 11, maxLevel: 20 },
  { name: "Gold", minLevel: 21, maxLevel: 35 },
  { name: "Platin", minLevel: 36, maxLevel: 50 },
  { name: "Diamant", minLevel: 51, maxLevel: 75 },
  { name: "Meister", minLevel: 76, maxLevel: 100 },
];
const quests: Quest[] = [
  { key: "daily-homework", title: "Fleißige Feder", detail: "Schließe eine Hausaufgabe ab", goal: 1, xp: 40, period: "daily", icon: BookOpen },
  { key: "daily-study", title: "Fokus-Modus", detail: "Lerne heute 30 Minuten", goal: 30, xp: 30, period: "daily", icon: Clock3 },
  { key: "weekly-homework", title: "Wochenplaner", detail: "Erledige 5 Hausaufgaben", goal: 5, xp: 120, period: "weekly", icon: CheckCircle2 },
  { key: "weekly-study", title: "Wissensjäger", detail: "Lerne diese Woche 120 Minuten", goal: 120, xp: 100, period: "weekly", icon: Zap },
  { key: "weekly-grades", title: "Prüfungsprofi", detail: "Trage 3 Noten ein", goal: 3, xp: 80, period: "weekly", icon: Star },
];
const achievements = [
  { key: "first-homework", title: "Erster Schritt", detail: "Schließe deine erste Hausaufgabe ab", xp: 50, icon: BookOpen, eligible: (d: Stats) => d.completedHomework >= 1 },
  { key: "study-five-hours", title: "Fokus-Legende", detail: "Lerne insgesamt 5 Stunden", xp: 100, icon: Clock3, eligible: (d: Stats) => d.totalStudyMinutes >= 300 },
  { key: "five-grades", title: "Notensammler", detail: "Trage 5 Noten ein", xp: 75, icon: GraduationCap, eligible: (d: Stats) => d.gradesCount >= 5 },
  { key: "week-streak", title: "Sieben Tage stark", detail: "Erreiche eine Lernserie von 7 Tagen", xp: 150, icon: Flame, eligible: (_stats: Stats, p: Profile | null) => (p?.streak_days ?? 0) >= 7 && Boolean(p?.last_study_date && p.last_study_date >= utcDate(new Date(Date.now() - 86400000))) },
];

type Stats = { completedHomework: number; totalStudyMinutes: number; gradesCount: number };
type Toast = { text: string; kind: "success" | "error" };

function currentLevel(xp: number) { return Math.min(100, Math.floor(xp / 100) + 1); }
function rankForLevel(level: number) {
  return rankTiers.find((rank) => level <= rank.maxLevel)?.name ?? "Meister";
}
function utcDate(date = new Date()) { return date.toISOString().slice(0, 10); }
function weekStartUtc() {
  const date = new Date(`${utcDate()}T00:00:00Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((day + 6) % 7));
  return utcDate(date);
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" }).format(new Date(`${value.slice(0, 10)}T12:00:00`));
}
function errorText(error: unknown) { return error instanceof Error ? error.message : "Es ist ein Fehler aufgetreten."; }

function App() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [page, setPage] = useState<NavPage>("Dashboard");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [homework, setHomework] = useState<Homework[]>([]);
  const [grades, setGrades] = useState<Grade[]>([]);
  const [studySessions, setStudySessions] = useState<StudySession[]>([]);
  const [events, setEvents] = useState<XPEvent[]>([]);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [questClaims, setQuestClaims] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">(getInitialAuthMode);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showHomeworkForm, setShowHomeworkForm] = useState(false);
  const [editingHomework, setEditingHomework] = useState<Homework | null>(null);
  const [showGradeForm, setShowGradeForm] = useState(false);
  const [showStudyForm, setShowStudyForm] = useState(false);
  const [studyMinutes, setStudyMinutes] = useState(15);
  const [showProfile, setShowProfile] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [levelUp, setLevelUp] = useState(false);
  const previousLevel = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    void getAppSession().then((nextSession) => {
      if (!active) return;
      setSession(nextSession);
      setAuthLoading(false);
    }).catch((error: unknown) => {
      if (!active) return;
      setToast({ text: errorText(error), kind: "error" });
      setAuthLoading(false);
    });
    const unsubscribe = subscribeToAuth((nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null); setHomework([]); setGrades([]); setStudySessions([]); setEvents([]); setUnlocked([]); setQuestClaims([]);
        setAuthMode("login");
        setShowProfile(false); setShowHomeworkForm(false); setShowGradeForm(false); setShowStudyForm(false);
      }
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  const refresh = useCallback(async () => {
    if (!session?.user.id) return;
    setLoading(true);
    const userId = session.user.id;
    try {
      const data = await loadUserData(userId);
      setProfile(data.profile);
      setHomework(data.homework);
      setGrades(data.grades);
      setStudySessions(data.studySessions);
      setEvents(data.events);
      setUnlocked(data.unlocked);
      setQuestClaims(data.questClaims.map((item) => `${item.quest_key}:${item.period_start}`));
    } catch (error) {
      setToast({ text: errorText(error), kind: "error" });
    } finally { setLoading(false); }
  }, [session?.user.id]);

  useEffect(() => { if (session) void refresh(); }, [session, refresh]);
  useEffect(() => {
    if (!session) return;
    let timeout = 0;
    const scheduleMidnightRefresh = () => {
      const now = Date.now();
      const nextDay = utcDate(new Date(now + 86_400_000));
      const delay = Date.parse(`${nextDay}T00:00:00Z`) - now + 50;
      timeout = window.setTimeout(() => {
        void refresh();
        scheduleMidnightRefresh();
      }, delay);
    };
    scheduleMidnightRefresh();
    return () => window.clearTimeout(timeout);
  }, [session, refresh]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const stats = useMemo<Stats>(() => ({
    completedHomework: homework.filter((task) => task.completed_at).length,
    totalStudyMinutes: studySessions.reduce((total, item) => total + item.minutes, 0),
    gradesCount: grades.length,
  }), [homework, studySessions, grades]);
  const average = useMemo(() => grades.length ? grades.reduce((total, item) => total + item.grade, 0) / grades.length : null, [grades]);
  const todaySessions = studySessions.filter((item) => item.created_at.slice(0, 10) === utcDate());
  const todayStudyMinutes = todaySessions.reduce((total, item) => total + item.minutes, 0);
  const todayHomework = homework.filter((item) => item.completed_at?.slice(0, 10) === utcDate()).length;
  const weekHomework = homework.filter((item) => item.completed_at && item.completed_at.slice(0, 10) >= weekStartUtc()).length;
  const weekGrades = grades.filter((item) => item.created_at.slice(0, 10) >= weekStartUtc()).length;
  const claimed = useMemo(() => new Set(questClaims), [questClaims]);
  const level = currentLevel(profile?.total_xp ?? 0);
  const xpInLevel = (profile?.total_xp ?? 0) % 100;
  const levelProgress = level === 100 ? 100 : xpInLevel;
  const displayName = profile?.display_name || session?.user.user_metadata?.display_name || "Abenteurer";
  const streakDays = profile?.last_study_date && profile.last_study_date < utcDate(new Date(Date.now() - 86400000)) ? 0 : profile?.streak_days ?? 0;
  useEffect(() => {
    const didLevelUp = previousLevel.current !== null && level > previousLevel.current;
    previousLevel.current = level;
    if (!didLevelUp) return;
    setLevelUp(true);
    const timeout = window.setTimeout(() => setLevelUp(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [level]);

  const runAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      await refresh();
      setToast({ text: success, kind: "success" });
      return true;
    } catch (error) { setToast({ text: errorText(error), kind: "error" }); }
    return false;
  };
  const completeHomework = (id: string) => runAction(() => completeHomeworkReward(session!.user.id, id), "Hausaufgabe erledigt! +50 XP");
  const claimQuest = (quest: Quest) => runAction(async () => {
    await claimQuestReward(session!.user.id, quest.key, quest.period === "daily" ? utcDate() : weekStartUtc());
  }, `Quest abgeschlossen! +${quest.xp} XP`);
  const unlockAchievement = (key: string) => runAction(() => unlockAchievementReward(session!.user.id, key), "Achievement freigeschaltet!");

  const addHomework = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const formData = new FormData(form.currentTarget);
    const values = {
      title: String(formData.get("title")).trim(),
      subject: String(formData.get("subject")).trim(),
      description: String(formData.get("description")).trim(),
      difficulty: String(formData.get("difficulty")) as Homework["difficulty"],
      due_date: String(formData.get("due_date")) || null,
    };
    if (!values.title || !values.subject) return;
    const saved = await runAction(async () => {
      if (editingHomework) await updateHomework(session!.user.id, editingHomework.id, values);
      else await createHomework(session!.user.id, values);
    }, editingHomework ? "Hausaufgabe aktualisiert!" : "Hausaufgabe erstellt!");
    if (saved) { setShowHomeworkForm(false); setEditingHomework(null); }
  };
  const addGrade = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const data = new FormData(form.currentTarget);
    const assessmentType = String(data.get("assessment_type"));
    if (assessmentType !== "test" && assessmentType !== "exam") {
      setToast({ text: "Bitte wähle Test oder Prüfung aus.", kind: "error" });
      return;
    }
    const saved = await runAction(() => submitGrade(
      session!.user.id, String(data.get("title")).trim(), String(data.get("subject")).trim(),
      Number(data.get("grade")), assessmentType,
    ), "Note gespeichert und XP gutgeschrieben!");
    if (saved) setShowGradeForm(false);
  };
  const addStudySession = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const data = new FormData(form.currentTarget);
    const minutes = Number(data.get("minutes"));
    const saved = await runAction(() => recordStudySession(session!.user.id, minutes, String(data.get("subject")).trim() || "Allgemein"), `Lernzeit erfasst! +${minutes} XP`);
    if (saved) setShowStudyForm(false);
  };
  const handleSaveProfile = async (form: FormEvent<HTMLFormElement>) => {
    form.preventDefault();
    const data = new FormData(form.currentTarget);
    const saved = await runAction(() => saveUserProfile(session!.user.id, {
      display_name: String(data.get("display_name")).trim(),
      avatar_url: String(data.get("avatar_url")).trim() || null,
    }), "Profil aktualisiert!");
    if (saved) setShowProfile(false);
  };

  if (authLoading) return <LoadingScreen />;
  if (!session) return <AuthScreen mode={authMode} setMode={setAuthMode} busy={authBusy} setBusy={setAuthBusy} error={authError} setError={setAuthError} localMode={isLocalMode} />;

  const greeting = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const activeHomework = homework.filter((item) => !item.completed_at);
  const recentEvents = events.slice(0, 5);
  const periods = quests.map((quest) => ({
    quest,
    progress: quest.key === "daily-homework" ? todayHomework
      : quest.key === "daily-study" ? todayStudyMinutes
        : quest.key === "weekly-homework" ? weekHomework
          : quest.key === "weekly-study" ? studySessions.filter((item) => item.created_at.slice(0, 10) >= weekStartUtc()).reduce((sum, item) => sum + item.minutes, 0)
            : weekGrades,
    isClaimed: claimed.has(`${quest.key}:${quest.period === "daily" ? utcDate() : weekStartUtc()}`),
  }));
  const earnedXP = (startDate: string, days: number) => {
    const range = Array.from({ length: days }, (_, index) => {
      const date = new Date(`${startDate}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      const key = utcDate(date);
      return {
        label: new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date).replace(".", ""),
        xp: events.filter((event) => event.created_at.slice(0, 10) === key).reduce((sum, event) => sum + event.xp, 0),
      };
    });
    return range;
  };
  const chartStart = (() => { const date = new Date(`${utcDate()}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 6); return utcDate(date); })();
  const chartData = earnedXP(chartStart, 7);
  const Avatar = ({ size = "md" }: { size?: "sm" | "md" | "lg" }) => {
    const className = size === "lg" ? "h-16 w-16 text-xl" : size === "sm" ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm";
    return profile?.avatar_url
      ? <img src={profile.avatar_url} alt="Profilbild" className={`${className} rounded-2xl object-cover ring-1 ring-white/10`} />
      : <div className={`${className} grid place-items-center rounded-2xl bg-gradient-to-br from-violet-500/80 to-indigo-500/80 font-bold text-white ring-1 ring-white/10`}>{displayName.slice(0, 1).toUpperCase()}</div>;
  };

  return (
    <div className="app-shell min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-[248px] shrink-0 border-r border-white/[.06] px-5 py-7 lg:flex lg:flex-col">
          <Brand />
          <div className="mt-12 px-3 text-[10px] font-bold uppercase tracking-[.2em] text-[#66687d]">Dein Abenteuer</div>
          <nav className="mt-3 space-y-1">
            {navigation.map((item) => <NavButton key={item.name} item={item} page={page} onClick={() => setPage(item.name)} />)}
          </nav>
          <div className="panel mt-auto rounded-2xl p-4">
            <div className="flex items-center gap-2 text-sm font-semibold"><Sparkles size={16} className="text-violet-300" /> Lern-Tipp</div>
            <p className="mt-2 text-xs leading-5 text-[#8d8ea2]">Kleine Lerneinheiten bringen dich Schritt für Schritt ans Ziel.</p>
            <button onClick={() => setShowStudyForm(true)} className="mt-3 text-xs font-semibold text-violet-300 hover:text-violet-200">Jetzt loslegen <span aria-hidden>→</span></button>
          </div>
          <div className="mt-5 flex items-center gap-3 rounded-2xl px-2 py-2">
            <button onClick={() => setShowProfile(true)} className="shrink-0" aria-label="Profil bearbeiten"><Avatar size="sm" /></button>
            <button onClick={() => setShowProfile(true)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-semibold">{displayName}</span>
              <span className="mt-0.5 block text-xs text-[#86879b]">Level {level} · {rankForLevel(level)}</span>
            </button>
            <button onClick={() => void signOut().catch((error: unknown) => setToast({ text: errorText(error), kind: "error" }))} aria-label="Abmelden" className="rounded-xl p-2 text-[#77798e] hover:bg-white/5 hover:text-white"><LogOut size={16} /></button>
          </div>
        </aside>

        <main className="mobile-safe min-w-0 flex-1 px-4 pb-8 pt-5 sm:px-7 lg:px-10 lg:pt-8">
          <header className="mb-7 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 lg:hidden">
              <button onClick={() => setMobileMenu(!mobileMenu)} className="rounded-xl border border-white/10 p-2 text-[#b8b8c8]" aria-label="Menü öffnen"><Menu size={19} /></button>
              <Brand compact />
            </div>
            <div className="hidden lg:block">
              <div className="text-sm font-medium capitalize text-[#8f90a5]">{greeting}</div>
              <h1 className="display-font mt-1 text-2xl font-bold tracking-tight">{page === "Dashboard" ? "Dein Abenteuer beginnt" : page}</h1>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="panel flex items-center gap-2 rounded-xl px-3 py-2"><Flame size={16} className="text-orange-400" /><span className="text-sm font-bold">{streakDays}</span><span className="hidden text-xs text-[#9696a9] sm:inline">Tage Serie</span></div>
              <button onClick={() => setShowProfile(true)} className="lg:hidden" aria-label="Profil bearbeiten"><Avatar size="sm" /></button>
            </div>
          </header>
          {mobileMenu && <div className="panel mb-5 grid grid-cols-2 gap-2 rounded-2xl p-3 lg:hidden">{navigation.map((item) => <NavButton key={item.name} item={item} page={page} onClick={() => { setPage(item.name); setMobileMenu(false); }} />)}</div>}
          {loading && <div className="fixed right-4 top-4 z-50 h-1 w-32 overflow-hidden rounded-full bg-[#29283c]"><div className="h-full w-1/2 animate-pulse bg-violet-400" /></div>}
          <div className="lg:hidden">
            <div className="text-xs font-medium capitalize text-[#8f90a5]">{greeting}</div>
            <h1 className="display-font mb-5 mt-1 text-2xl font-bold tracking-tight">{page === "Dashboard" ? "Dein Abenteuer beginnt" : page}</h1>
          </div>

          {page === "Dashboard" && <DashboardPage
            userId={session.user.id} onSaveStudy={(minutes, subject) => runAction(
              () => recordStudySession(session.user.id, minutes, subject),
              `Lernzeit erfasst! +${minutes} XP`,
            )}
            profile={profile} name={displayName} level={level} xpInLevel={xpInLevel} progress={levelProgress} levelUp={levelUp}
            stats={stats} average={average} activeHomework={activeHomework} events={recentEvents}
            quests={periods} chartData={chartData} onComplete={completeHomework} onClaim={claimQuest}
            onNavigate={setPage} onStudy={() => { setStudyMinutes(15); setShowStudyForm(true); }} onAddHomework={() => { setEditingHomework(null); setShowHomeworkForm(true); }}
            Avatar={Avatar} />
          }
          {page === "Aufgaben" && <HomeworkPage homework={homework} onAdd={() => { setEditingHomework(null); setShowHomeworkForm(true); }} onEdit={(item) => { setEditingHomework(item); setShowHomeworkForm(true); }} onComplete={completeHomework} onDelete={(id) => void runAction(() => deleteHomework(session.user.id, id), "Aufgabe gelöscht.")} />}
          {page === "Noten" && <GradesPage grades={grades} average={average} onAdd={() => setShowGradeForm(true)} />}
          {page === "Statistiken" && <StatisticsPage stats={stats} grades={grades} average={average} chartData={chartData} events={events} />}
          {page === "Ränge" && <RanksPage totalXP={profile?.total_xp ?? 0} homework={homework} grades={grades} studySessions={studySessions} />}
          {page === "Erfolge" && <AchievementsPage stats={stats} profile={profile} unlocked={unlocked} onUnlock={unlockAchievement} />}
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-6 border-t border-white/[.08] bg-[#0d0f19]/95 px-1 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur-xl lg:hidden">
        {navigation.map(({ name, icon: Icon }) => <button key={name} onClick={() => setPage(name)} className={`nav-item flex flex-col items-center gap-1 rounded-xl py-1.5 text-[10px] ${page === name ? "active" : "text-[#797b90]"}`}><Icon size={18} />{name}</button>)}
      </nav>
      {toast && <div role="status" className={`fixed bottom-24 left-1/2 z-[70] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 text-sm shadow-2xl lg:bottom-7 ${toast.kind === "error" ? "border-red-400/20 bg-[#291b25] text-red-200" : "border-emerald-300/20 bg-[#14251f] text-emerald-100"}`}><span>{toast.kind === "error" ? <CircleHelp size={17} /> : <Check size={17} />}</span>{toast.text}</div>}
      {showHomeworkForm && <Modal title={editingHomework ? "Hausaufgabe bearbeiten" : "Neue Hausaufgabe"} onClose={() => { setShowHomeworkForm(false); setEditingHomework(null); }}><form onSubmit={addHomework} className="space-y-4"><Field label="Aufgabe"><input name="title" required maxLength={120} defaultValue={editingHomework?.title ?? ""} placeholder="z. B. Kapitel 4 zusammenfassen" className="input" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Fach"><input name="subject" required maxLength={60} defaultValue={editingHomework?.subject ?? ""} placeholder="Biologie" className="input" /></Field><Field label="Schwierigkeit"><select name="difficulty" defaultValue={editingHomework?.difficulty ?? "Mittel"} className="input"><option>Leicht</option><option>Mittel</option><option>Schwer</option></select></Field></div><Field label="Beschreibung (optional)"><textarea name="description" rows={3} maxLength={1000} defaultValue={editingHomework?.description ?? ""} placeholder="Was ist zu tun?" className="input resize-none" /></Field><Field label="Fällig am"><input type="date" name="due_date" min={editingHomework ? undefined : utcDate()} defaultValue={editingHomework?.due_date ?? ""} className="input" /></Field><FormSubmit>{editingHomework ? "Änderungen speichern" : "Hausaufgabe erstellen"}</FormSubmit></form></Modal>}
      {showGradeForm && <Modal title="Note eintragen" onClose={() => setShowGradeForm(false)}><form onSubmit={addGrade} className="space-y-4"><Field label="Prüfung"><input name="title" required maxLength={120} placeholder="z. B. Zellbiologie-Test" className="input" /></Field><div className="grid gap-4 sm:grid-cols-2"><Field label="Fach"><input name="subject" required maxLength={60} placeholder="Biologie" className="input" /></Field><Field label="Note"><select name="grade" className="input">{[1, 2, 3, 4, 5].map((number) => <option key={number} value={number}>{number}{number === 1 ? " – Sehr gut" : number === 2 ? " – Gut" : number === 3 ? " – Befriedigend" : number === 4 ? " – Ausreichend" : " – Mangelhaft"}</option>)}</select></Field></div><Field label="Art"><select name="assessment_type" className="input"><option value="test">Test</option><option value="exam">Klausur / Prüfung</option></select></Field><div className="rounded-xl border border-violet-400/15 bg-violet-400/[.06] p-3 text-xs text-[#b9b5cf]">XP gibt’s automatisch: Tests bis zu 200 XP, Prüfungen bis zu 400 XP.</div><FormSubmit>Note speichern</FormSubmit></form></Modal>}
      {showStudyForm && <Modal title="Lernzeit erfassen" onClose={() => setShowStudyForm(false)}><form onSubmit={addStudySession} className="space-y-4"><p className="text-sm leading-6 text-[#9899aa]">Trage ein, wie viele Minuten du gelernt hast. Pro Minute erhältst du 1 XP.</p><Field label="Lernzeit in Minuten"><input type="number" name="minutes" min={1} max={600} step={1} required value={studyMinutes} onChange={(event) => setStudyMinutes(Number(event.target.value))} className="input" /><span className="mt-1 block text-xs text-violet-200">Belohnung: +{studyMinutes > 0 && studyMinutes <= 600 ? studyMinutes : 0} XP</span></Field><Field label="Fach (optional)"><input name="subject" maxLength={60} placeholder="Allgemein" className="input" /></Field><FormSubmit>Lerneinheit speichern</FormSubmit></form></Modal>}
      {showProfile && <Modal title="Dein Profil" onClose={() => setShowProfile(false)}><form onSubmit={handleSaveProfile} className="space-y-4"><div className="flex items-center gap-4"><Avatar size="lg" /><div><div className="font-semibold">{displayName}</div><div className="mt-1 text-xs text-[#85869a]">Level {level} · {rankForLevel(level)}</div></div></div><Field label="Anzeigename"><input name="display_name" required maxLength={40} defaultValue={displayName} className="input" /></Field><Field label="Profilbild-URL (optional)"><input name="avatar_url" type="url" maxLength={500} defaultValue={profile?.avatar_url ?? ""} placeholder="https://…" className="input" /></Field><div className="text-xs text-[#77798c]">{session.user.email}</div><FormSubmit>Profil speichern</FormSubmit><button type="button" onClick={() => void signOut().catch((error: unknown) => setToast({ text: errorText(error), kind: "error" }))} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 py-3 text-sm text-[#b9b7c8] hover:bg-white/5"><LogOut size={16} /> Abmelden</button></form></Modal>}
    </div>
  );
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-[14px] bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_0_24px_rgba(117,83,242,.3)]"><Zap size={21} fill="white" className="text-white" /></div><div><div className="display-font text-[19px] font-bold tracking-tight">Study<span className="text-violet-300">Quest</span></div>{!compact && <div className="mt-0.5 text-[10px] tracking-wide text-[#77798d]">Lernen. Spielen. Wachsen.</div>}</div></div>;
}
function NavButton({ item, page, onClick }: { item: { name: NavPage; icon: typeof House }; page: NavPage; onClick: () => void }) {
  const Icon = item.icon;
  return <button onClick={onClick} className={`nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm ${page === item.name ? "active font-semibold" : "text-[#9697aa]"}`}><Icon size={18} strokeWidth={1.8} />{item.name}{page === item.name && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-violet-300" />}</button>;
}
function LoadingScreen() { return <div className="app-shell grid min-h-screen place-items-center"><div className="flex items-center gap-3 text-sm text-[#9d9caf]"><div className="h-5 w-5 animate-spin rounded-full border-2 border-violet-400 border-t-transparent" />Dein Abenteuer wird geladen …</div></div>; }
function AuthScreen({ mode, setMode, busy, setBusy, error, setError, localMode }: { mode: "login" | "register"; setMode: (mode: "login" | "register") => void; busy: boolean; setBusy: (busy: boolean) => void; error: string; setError: (error: string) => void; localMode: boolean }) {
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim();
    const password = String(data.get("password"));
    try {
      if (mode === "register") {
        const displayName = String(data.get("display_name")).trim();
        const result = await register(email, password, displayName);
        if (result.emailConfirmationRequired) {
          setError("Fast geschafft! Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach.");
        }
      } else {
        await signIn(email, password);
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  const resendConfirmation = async (form: HTMLFormElement) => {
    const email = String(new FormData(form).get("email")).trim();
    if (!email) {
      setError("Bitte gib zuerst deine E-Mail-Adresse ein.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await resendSignupConfirmation(email);
      setError("Ein neuer Bestätigungslink wurde angefordert. Bitte prüfe dein Postfach.");
    } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <div className="app-shell grid min-h-screen place-items-center px-4 py-10"><div className="panel w-full max-w-[430px] rounded-3xl p-7 sm:p-9"><Brand />{localMode && <div className="mt-6 rounded-xl border border-amber-300/15 bg-amber-300/[.06] px-3 py-2 text-xs leading-5 text-amber-100/80">Lokales Testkonto: deine Daten bleiben in diesem Browser und werden nicht online synchronisiert.</div>}<div className="mt-8"><h1 className="display-font text-2xl font-bold">{mode === "login" ? "Willkommen zurück!" : "Konto erstellen"}</h1><p className="mt-2 text-sm text-[#9293a7]">{mode === "login" ? "Melde dich an und setze deine Quest fort." : "Erstelle dein Konto und starte dein Lernabenteuer."}</p></div><form onSubmit={submit} className="mt-7 space-y-4">{mode === "register" && <Field label="Dein Name"><input name="display_name" required maxLength={40} autoComplete="name" placeholder="Alex" className="input" /></Field>}<Field label="E-Mail"><input type="email" name="email" required autoComplete="email" placeholder="du@beispiel.de" className="input" /></Field><Field label="Passwort"><input type="password" name="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="Mindestens 8 Zeichen" className="input" /></Field>{error && <div role="alert" className={`rounded-xl border p-3 text-sm ${error.startsWith("Fast") || error.startsWith("Ein neuer Bestätigungslink") ? "border-emerald-400/15 bg-emerald-400/[.06] text-emerald-200" : "border-red-400/15 bg-red-400/[.06] text-red-200"}`}>{error}</div>}<button disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-bold shadow-lg shadow-violet-950/30 transition hover:brightness-110 disabled:opacity-60">{busy ? "Einen Moment …" : mode === "login" ? "Anmelden" : "Konto erstellen"}{!busy && <ChevronRight size={17} />}</button>{!localMode && <button type="button" disabled={busy} onClick={(event) => { const form = event.currentTarget.form; if (form) void resendConfirmation(form); }} className="w-full text-xs font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-60">Bestätigungs-E-Mail erneut senden</button>}</form><div className="mt-6 text-center text-sm text-[#8e8fa2]">{mode === "login" ? "Noch kein Konto?" : "Schon ein Konto?"} <button onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }} className="ml-1 font-semibold text-violet-300 hover:text-violet-200">{mode === "login" ? "Registrieren" : "Anmelden"}</button></div><div className="mt-7 flex items-center justify-center gap-2 text-xs text-[#686a7c]"><ShieldCheck size={14} /> {localMode ? "Testkonto nur auf diesem Gerät" : "Deine Daten sind geschützt."}</div></div></div>;
}

function DashboardPage(props: {
  userId: string; onSaveStudy: (minutes: number, subject: string) => Promise<boolean>;
  profile: Profile | null; name: string; level: number; xpInLevel: number; progress: number; levelUp: boolean; stats: Stats; average: number | null;
  activeHomework: Homework[]; events: XPEvent[]; quests: { quest: Quest; progress: number; isClaimed: boolean }[];
  chartData: { label: string; xp: number }[]; onComplete: (id: string) => void; onClaim: (quest: Quest) => void;
  onNavigate: (page: NavPage) => void; onStudy: () => void; onAddHomework: () => void; Avatar: (props: { size?: "sm" | "md" | "lg" }) => ReactNode;
}) {
  const { userId, onSaveStudy, profile, name, level, xpInLevel, progress, levelUp, stats, average, activeHomework, events, quests: questData, chartData, onComplete, onClaim, onNavigate, onStudy, onAddHomework, Avatar } = props;
  const daily = questData.filter((item) => item.quest.period === "daily");
  const weekly = questData.filter((item) => item.quest.period === "weekly");
  return <div className="space-y-5">
    <section className="panel relative overflow-hidden rounded-3xl p-5 sm:p-7">
      <div className="pointer-events-none absolute -right-10 -top-20 h-64 w-64 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="relative grid gap-6 md:grid-cols-[1.2fr_.8fr] md:items-center">
        <div><div className="flex items-center gap-3"><Avatar /><div><div className="text-xs text-[#9697a9]">Schön, dass du da bist 👋</div><div className="mt-0.5 font-semibold">{name}</div></div></div><h2 className="display-font mt-5 text-2xl font-bold sm:text-3xl">Heute ist ein guter Tag,<br className="hidden sm:block" /> um <span className="text-violet-300">weiterzukommen.</span></h2><p className="mt-2 max-w-md text-sm leading-6 text-[#8f90a4]">Jede Lerneinheit bringt dich deinem nächsten Level näher. Deine nächste Quest wartet schon!</p><div className="mt-5 flex flex-wrap gap-2"><button onClick={onStudy} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-bold shadow-lg shadow-violet-950/30 hover:brightness-110"><Zap size={16} /> Lernzeit erfassen</button><button onClick={onAddHomework} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] px-4 py-2.5 text-sm font-semibold text-[#d3d1df] hover:bg-white/[.07]"><Plus size={16} /> Aufgabe hinzufügen</button></div></div>
        <div className="rounded-2xl border border-white/[.07] bg-black/15 p-5 sm:p-6">
          <div className="flex items-start justify-between"><div><div className="text-xs font-semibold uppercase tracking-[.14em] text-[#898a9f]">Dein Rang</div><div className="display-font mt-2 text-2xl font-bold">{rankForLevel(level)}</div></div><div className={`grid h-12 w-12 place-items-center rounded-2xl bg-violet-400/10 text-violet-300 ${levelUp ? "level-up" : ""}`}><Trophy size={23} /></div></div>
          <div className="mt-5 flex items-end justify-between"><div><div className="text-xs text-[#87889d]">Aktuelles Level</div><div className="display-font mt-0.5 text-3xl font-bold">Lvl {level}<span className="ml-2 text-sm font-medium text-[#9293a5]">/ 100</span></div></div><div className="text-right"><div className="text-sm font-bold text-violet-200">{profile?.total_xp ?? 0} XP</div><div className="mt-0.5 text-[11px] text-[#828397]">Gesamt</div></div></div>
          <div className="progress-track mt-4 h-2.5 overflow-hidden rounded-full"><div className="progress-fill h-full rounded-full transition-all duration-700" style={{ width: `${progress}%` }} /></div>
          <div className="mt-2 flex justify-between text-[11px] text-[#838498]"><span>{level === 100 ? "Maximallevel erreicht!" : `${xpInLevel} / 100 XP`}</span><span>{level === 100 ? "Meister" : `${100 - xpInLevel} XP bis Level ${level + 1}`}</span></div>
        </div>
      </div>
    </section>
    <StudyStopwatch key={userId} userId={userId} onSave={onSaveStudy} />
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard icon={Zap} label="Gesamt-XP" value={(profile?.total_xp ?? 0).toLocaleString("de-DE")} accent="violet" />
      <StatCard icon={Clock3} label="Lernzeit" value={formatMinutes(stats.totalStudyMinutes)} accent="blue" />
      <StatCard icon={CheckCircle2} label="Erledigt" value={String(stats.completedHomework)} accent="green" />
      <StatCard icon={GraduationCap} label="Notenschnitt" value={average === null ? "–" : average.toFixed(1).replace(".", ",")} accent="amber" />
    </section>
    <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <div className="panel rounded-2xl p-5 sm:p-6"><SectionHeading icon={Target} title="Tägliche Quests" subtitle="Kleine Schritte, große Fortschritte" /><div className="mt-5 space-y-3">{daily.map(({ quest, progress: questProgress, isClaimed }) => <QuestRow key={quest.key} quest={quest} progress={questProgress} isClaimed={isClaimed} onClaim={() => onClaim(quest)} />)}</div><div className="mt-5 border-t border-white/[.06] pt-5"><SectionHeading icon={CalendarDays} title="Wochenquests" subtitle="Deine Ziele für diese Woche" /><div className="mt-4 space-y-3">{weekly.map(({ quest, progress: questProgress, isClaimed }) => <QuestRow key={quest.key} quest={quest} progress={questProgress} isClaimed={isClaimed} onClaim={() => onClaim(quest)} />)}</div></div></div>
      <div className="space-y-5">
        <div className="panel rounded-2xl p-5"><div className="flex items-center justify-between"><SectionHeading icon={Activity} title="Dein Wochenfortschritt" subtitle="Verdiente XP der letzten 7 Tage" /><button onClick={() => onNavigate("Statistiken")} className="rounded-lg p-2 text-[#85869a] hover:bg-white/5 hover:text-white" aria-label="Alle Statistiken"><ChevronRight size={17} /></button></div><div className="mt-4 h-[160px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 3, left: -20, bottom: 0 }}><defs><linearGradient id="xpGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#9b7aff" stopOpacity={0.28} /><stop offset="95%" stopColor="#9b7aff" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 5" className="chart-grid" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#85869b", fontSize: 10 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#77798f", fontSize: 10 }} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="xp" stroke="#a78bfa" strokeWidth={2} fill="url(#xpGradient)" activeDot={{ r: 4, fill: "#c5b5ff" }} /></AreaChart></ResponsiveContainer></div></div>
        <div className="panel rounded-2xl p-5"><div className="flex items-center justify-between"><SectionHeading icon={ScrollText} title="Nächste Aufgaben" subtitle={`${activeHomework.length} offen`} /><button onClick={() => onNavigate("Aufgaben")} className="text-xs font-semibold text-violet-300 hover:text-violet-200">Alle anzeigen</button></div>{activeHomework.length ? <div className="mt-4 space-y-2.5">{activeHomework.slice(0, 3).map((item) => <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/[.05] bg-white/[.015] p-3"><button onClick={() => onComplete(item.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/10 text-[#77798d] hover:border-emerald-300/30 hover:text-emerald-300" aria-label={`${item.title} erledigen`}><Check size={14} /></button><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{item.title}</div><div className="mt-1 text-[11px] text-[#818397]">{item.subject}{item.due_date ? ` · bis ${formatDate(item.due_date)}` : ""}</div></div><span className="text-[11px] font-semibold text-violet-300">+50 XP</span></div>)}</div> : <EmptyState text="Alles erledigt – stark gemacht!" action="Neue Aufgabe" onClick={onAddHomework} />}</div>
        <div className="panel rounded-2xl p-5"><SectionHeading icon={Sparkles} title="Letzte Aktivitäten" subtitle="Deine jüngsten Erfolge" />{events.length ? <div className="mt-4 space-y-3">{events.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Zap size={15} /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{item.description}</div><div className="mt-0.5 text-[10px] text-[#74768a]">{formatDate(item.created_at)}</div></div><span className="text-xs font-semibold text-emerald-300">+{item.xp}</span></div>)}</div> : <div className="mt-4 text-xs text-[#77798b]">Deine ersten XP warten auf dich.</div>}</div>
      </div>
    </section>
  </div>;
}

type StopwatchState = { elapsedMs: number; startedAt: number | null; subject: string };
const maxStopwatchMs = 600 * 60_000;

function formatStopwatchTime(milliseconds: number) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function StudyStopwatch({ userId, onSave }: { userId: string; onSave: (minutes: number, subject: string) => Promise<boolean> }) {
  const storageKey = `studyquest.stopwatch.v1:${userId}`;
  const [stopwatch, setStopwatch] = useState<StopwatchState>(() => {
    const saved = localStorage.getItem(storageKey);
    return saved ? JSON.parse(saved) as StopwatchState : { elapsedMs: 0, startedAt: null, subject: "" };
  });
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(stopwatch)); }, [storageKey, stopwatch]);
  useEffect(() => {
    if (stopwatch.startedAt === null) return;
    const startedAt = stopwatch.startedAt;
    const interval = window.setInterval(() => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (stopwatch.elapsedMs + currentTime - startedAt >= maxStopwatchMs) {
        setStopwatch({ ...stopwatch, elapsedMs: maxStopwatchMs, startedAt: null });
      }
    }, 1000);
    return () => window.clearInterval(interval);
  }, [stopwatch]);

  const elapsedMs = Math.min(maxStopwatchMs, stopwatch.elapsedMs + (stopwatch.startedAt === null ? 0 : now - stopwatch.startedAt));
  const isRunning = stopwatch.startedAt !== null;
  const toggleTimer = () => {
    const currentTime = Date.now();
    setNow(currentTime);
    setStopwatch((current) => current.startedAt === null
      ? { ...current, startedAt: currentTime }
      : { ...current, elapsedMs: Math.min(maxStopwatchMs, current.elapsedMs + currentTime - current.startedAt), startedAt: null });
  };
  const saveSession = async () => {
    const currentElapsedMs = Math.min(maxStopwatchMs, stopwatch.elapsedMs + (stopwatch.startedAt === null ? 0 : Date.now() - stopwatch.startedAt));
    const elapsedMinutes = Math.floor(currentElapsedMs / 60_000);
    if (elapsedMinutes < 1) return;
    setStopwatch((current) => ({ ...current, elapsedMs: currentElapsedMs, startedAt: null }));
    setSaving(true);
    const saved = await onSave(elapsedMinutes, stopwatch.subject.trim() || "Allgemein");
    setSaving(false);
    if (saved) setStopwatch({ elapsedMs: 0, startedAt: null, subject: "" });
  };
  const reset = () => setStopwatch({ elapsedMs: 0, startedAt: null, subject: "" });

  return <section className="panel rounded-2xl p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><Clock3 size={18} className="text-violet-300" /><h2 className="font-semibold">Lern-Stoppuhr</h2></div><p className="mt-1 text-xs text-[#85869a]">Tracke deine Lernzeit live – auch wenn du die Seite neu lädst.</p></div>
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${isRunning ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[.05] text-[#85869a]"}`}>{isRunning ? "Läuft" : "Bereit"}</span>
    </div>
    <div className="mt-5 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
      <div>
        <div className="display-font text-4xl font-bold tabular-nums tracking-wider text-white sm:text-5xl" role="timer" aria-label={`Lernzeit ${formatStopwatchTime(elapsedMs)}`}>{formatStopwatchTime(elapsedMs)}</div>
        <p className="mt-2 text-[11px] text-[#85869a]">Es werden volle Minuten gespeichert (max. 10 Stunden pro Einheit).</p>
        <div className="mt-4 max-w-sm"><Field label="Fach (optional)"><input value={stopwatch.subject} onChange={(event) => setStopwatch((current) => ({ ...current, subject: event.target.value }))} maxLength={60} placeholder="Allgemein" className="input" /></Field></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={toggleTimer} disabled={!isRunning && elapsedMs >= maxStopwatchMs} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-sm font-bold hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">{isRunning ? <><Pause size={16} />Pause</> : <><Play size={16} />{elapsedMs > 0 ? "Weiter" : "Start"}</>}</button>
        <button type="button" onClick={() => void saveSession()} disabled={saving || Math.floor(elapsedMs / 60_000) < 1} className="rounded-xl border border-white/10 bg-white/[.03] px-4 py-2.5 text-sm font-semibold text-[#d3d1df] hover:bg-white/[.07] disabled:cursor-not-allowed disabled:opacity-40">{saving ? "Speichert …" : "Lerneinheit speichern"}</button>
        <button type="button" onClick={reset} disabled={saving || (elapsedMs === 0 && !isRunning && !stopwatch.subject)} aria-label="Stoppuhr zurücksetzen" title="Zurücksetzen" className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 text-[#85869a] hover:bg-white/[.05] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"><RotateCcw size={16} /></button>
      </div>
    </div>
  </section>;
}

function QuestRow({ quest, progress, isClaimed, onClaim }: { quest: Quest; progress: number; isClaimed: boolean; onClaim: () => void }) {
  const Icon = quest.icon;
  const done = progress >= quest.goal;
  return <div className={`flex items-center gap-3 rounded-xl border border-white/[.055] bg-white/[.018] p-3 ${isClaimed ? "quest-complete opacity-70" : ""}`}>
    <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${done ? "bg-emerald-300/10 text-emerald-300" : "bg-violet-300/10 text-violet-300"}`}>{done ? <CheckCircle2 size={17} /> : <Icon size={17} />}</div>
    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-xs font-semibold">{quest.title}</span><span className="rounded-md bg-violet-400/[.08] px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">+{quest.xp} XP</span></div><div className="mt-1 text-[10px] text-[#818397]">{quest.detail}</div><div className="progress-track mt-2 h-1.5 overflow-hidden rounded-full"><div className="quest-fill h-full rounded-full transition-all" style={{ width: `${Math.min(100, progress / quest.goal * 100)}%` }} /></div></div>
    <div className="flex shrink-0 flex-col items-end gap-1.5"><span className="text-[10px] text-[#85869a]">{Math.min(progress, quest.goal)}/{quest.goal}</span>{isClaimed ? <span className="text-[10px] font-semibold text-emerald-300">Erhalten</span> : <button disabled={!done} onClick={onClaim} className="rounded-lg bg-violet-400/10 px-2.5 py-1 text-[10px] font-bold text-violet-200 disabled:cursor-not-allowed disabled:opacity-35 hover:bg-violet-400/20">Abholen</button>}</div>
  </div>;
}

function HomeworkPage({ homework, onAdd, onEdit, onComplete, onDelete }: { homework: Homework[]; onAdd: () => void; onEdit: (item: Homework) => void; onComplete: (id: string) => void; onDelete: (id: string) => void }) {
  const [filter, setFilter] = useState<"alle" | "offen" | "erledigt">("alle");
  const items = homework.filter((item) => filter === "alle" || (filter === "offen" ? !item.completed_at : Boolean(item.completed_at)));
  return <div className="space-y-5">
    <PageIntro icon={ScrollText} title="Deine Hausaufgaben" description="Organisiere deine Aufgaben und sammle für jeden Abschluss 50 XP." action={<PrimaryButton onClick={onAdd}><Plus size={16} />Neue Aufgabe</PrimaryButton>} />
    <div className="panel rounded-2xl p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex gap-1 rounded-xl bg-black/20 p-1">{(["alle", "offen", "erledigt"] as const).map((value) => <button key={value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize ${filter === value ? "bg-violet-400/15 text-violet-200" : "text-[#85869a] hover:text-white"}`}>{value} {value === "alle" ? `(${homework.length})` : value === "offen" ? `(${homework.filter((item) => !item.completed_at).length})` : `(${homework.filter((item) => item.completed_at).length})`}</button>)}</div></div>
      {items.length ? <div className="grid gap-3 md:grid-cols-2">{items.map((item) => <article key={item.id} className="panel-soft hover-card rounded-2xl p-4">
        <div className="flex items-start gap-3"><button disabled={Boolean(item.completed_at)} onClick={() => onComplete(item.id)} className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl border ${item.completed_at ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : "border-white/10 text-[#797b90] hover:border-emerald-300/30 hover:text-emerald-300"}`} aria-label="Aufgabe abschließen"><Check size={16} /></button>
          <div className="min-w-0 flex-1"><div className={`font-semibold ${item.completed_at ? "text-[#9293a4] line-through" : ""}`}>{item.title}</div><div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#85869a]"><span>{item.subject}</span><span className="text-[#55576b]">·</span><span>{item.difficulty}</span>{item.due_date && <><span className="text-[#55576b]">·</span><span>Fällig {formatDate(item.due_date)}</span></>}</div>{item.description && <p className="mt-3 text-xs leading-5 text-[#a0a0b0]">{item.description}</p>}
            <div className="mt-4 flex items-center justify-between"><span className={`text-xs font-semibold ${item.completed_at ? "text-emerald-300" : "text-violet-300"}`}>{item.completed_at ? "Quest abgeschlossen" : "+50 XP bei Abschluss"}</span><div className="flex gap-1"><button onClick={() => onEdit(item)} className="rounded-lg p-1.5 text-[#77798d] hover:bg-violet-400/10 hover:text-violet-200" aria-label={`${item.title} bearbeiten`}><Pencil size={15} /></button><button onClick={() => onDelete(item.id)} className="rounded-lg p-1.5 text-[#67697c] hover:bg-red-400/10 hover:text-red-300" aria-label="Aufgabe löschen"><X size={15} /></button></div></div>
          </div></div></article>)}</div> : <EmptyLarge title={filter === "erledigt" ? "Noch keine erledigten Aufgaben" : "Deine Questliste ist leer"} detail="Füge eine Hausaufgabe hinzu und sammle deine ersten XP." action="Hausaufgabe hinzufügen" onClick={onAdd} />}
    </div>
  </div>;
}
function GradesPage({ grades, average, onAdd }: { grades: Grade[]; average: number | null; onAdd: () => void }) {
  const reward = (grade: Grade) => grade.xp_earned;
  return <div className="space-y-5"><PageIntro icon={GraduationCap} title="Noten & Prüfungen" description="Jede Note zählt. Deine XP und dein Notenschnitt werden automatisch berechnet." action={<PrimaryButton onClick={onAdd}><Plus size={16} />Note eintragen</PrimaryButton>} /><div className="grid gap-4 sm:grid-cols-3"><StatCard icon={GraduationCap} label="Notenschnitt" value={average === null ? "–" : average.toFixed(2).replace(".", ",")} accent="violet" /><StatCard icon={BookOpen} label="Eingetragene Noten" value={String(grades.length)} accent="blue" /><StatCard icon={Zap} label="XP aus Noten" value={grades.reduce((sum, item) => sum + reward(item), 0).toLocaleString("de-DE")} accent="amber" /></div><div className="panel overflow-hidden rounded-2xl"><div className="flex items-center justify-between border-b border-white/[.06] p-5"><div><h2 className="font-semibold">Deine Ergebnisse</h2><p className="mt-1 text-xs text-[#838498]">Tests und Prüfungen im Überblick</p></div><Award className="text-violet-300" size={20} /></div>{grades.length ? <div className="divide-y divide-white/[.05]">{grades.map((item) => <div key={item.id} className="flex items-center gap-3 px-5 py-4 sm:gap-4"><div className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl text-lg font-bold ${item.grade <= 2 ? "bg-emerald-400/10 text-emerald-300" : item.grade === 3 ? "bg-sky-400/10 text-sky-300" : "bg-amber-400/10 text-amber-300"}`}>{item.grade}</div><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{item.title}</div><div className="mt-1 text-xs text-[#85869a]">{item.subject} · {item.assessment_type === "exam" ? "Klausur / Prüfung" : "Test"} · {formatDate(item.created_at)}</div></div><div className="text-right"><div className="text-sm font-semibold text-violet-200">+{item.xp_earned} XP</div><div className="mt-1 text-[10px] text-[#77798c]">{item.grade === 1 ? "Sehr gut" : item.grade === 2 ? "Gut" : item.grade === 3 ? "Befriedigend" : item.grade === 4 ? "Ausreichend" : "Mangelhaft"}</div></div></div>)}</div> : <EmptyLarge title="Noch keine Noten" detail="Trage deinen nächsten Test oder deine nächste Prüfung ein." action="Note eintragen" onClick={onAdd} />}</div></div>;
}
function StatisticsPage({ stats, grades, average, chartData, events }: { stats: Stats; grades: Grade[]; average: number | null; chartData: { label: string; xp: number }[]; events: XPEvent[] }) {
  const subjects = [...new Set(grades.map((item) => item.subject))].map((subject) => {
    const subjectGrades = grades.filter((item) => item.subject === subject);
    return { subject, average: subjectGrades.reduce((sum, item) => sum + item.grade, 0) / subjectGrades.length, count: subjectGrades.length };
  }).sort((a, b) => a.average - b.average);
  return <div className="space-y-5"><PageIntro icon={Activity} title="Deine Statistiken" description="Sieh, wie viel du erreicht hast – und wo deine Reise weitergeht." /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><StatCard icon={Zap} label="Verdiente XP" value={events.reduce((sum, item) => sum + item.xp, 0).toLocaleString("de-DE")} accent="violet" /><StatCard icon={Clock3} label="Lernzeit insgesamt" value={formatMinutes(stats.totalStudyMinutes)} accent="blue" /><StatCard icon={CheckCircle2} label="Abgeschlossene Aufgaben" value={String(stats.completedHomework)} accent="green" /><StatCard icon={GraduationCap} label="Notendurchschnitt" value={average === null ? "–" : average.toFixed(2).replace(".", ",")} accent="amber" /></div><div className="grid gap-5 xl:grid-cols-[1.3fr_.7fr]"><div className="panel rounded-2xl p-5 sm:p-6"><SectionHeading icon={Activity} title="XP-Verlauf" subtitle="Deine verdienten Erfahrungspunkte der letzten 7 Tage" /><div className="mt-5 h-[290px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData} margin={{ top: 8, right: 12, left: -15, bottom: 0 }}><defs><linearGradient id="statsGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#8b6cff" stopOpacity={0.3} /><stop offset="100%" stopColor="#8b6cff" stopOpacity={0} /></linearGradient></defs><CartesianGrid vertical={false} strokeDasharray="3 5" className="chart-grid" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#85869b", fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#77798f", fontSize: 11 }} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="xp" stroke="#a78bfa" strokeWidth={2.5} fill="url(#statsGradient)" activeDot={{ r: 5, fill: "#c5b5ff" }} /></AreaChart></ResponsiveContainer></div></div><div className="panel rounded-2xl p-5"><SectionHeading icon={GraduationCap} title="Noten nach Fach" subtitle="Durchschnitt pro Fach" />{subjects.length ? <div className="mt-5 space-y-4">{subjects.map((item) => <div key={item.subject}><div className="mb-2 flex items-center justify-between text-xs"><span className="font-medium">{item.subject}</span><span className="text-[#a5a3b4]">{item.average.toFixed(1).replace(".", ",")} <span className="text-[#77798b]">({item.count})</span></span></div><div className="progress-track h-2 overflow-hidden rounded-full"><div className={`h-full rounded-full ${item.average <= 2 ? "bg-emerald-400" : item.average <= 3 ? "bg-sky-400" : "bg-amber-400"}`} style={{ width: `${(6 - item.average) / 5 * 100}%` }} /></div></div>)}</div> : <p className="mt-6 text-sm text-[#77798b]">Trage Noten ein, um deine Fachstatistik zu sehen.</p>}<div className="mt-6 rounded-xl border border-white/[.06] bg-white/[.02] p-3 text-xs text-[#9293a5]">Deine Lernzeit: <span className="font-semibold text-[#d9d7e4]">{stats.totalStudyMinutes} Minuten</span> in {Math.ceil(stats.totalStudyMinutes / 60)} Stunden Lernen.</div></div></div></div>;
}
function AchievementsPage({ stats, profile, unlocked, onUnlock }: { stats: Stats; profile: Profile | null; unlocked: string[]; onUnlock: (key: string) => void }) {
  return <div className="space-y-5"><PageIntro icon={Trophy} title="Erfolge & Achievements" description="Stell dich neuen Herausforderungen und verdiene Bonus-XP." /><div className="grid gap-4 md:grid-cols-2">{achievements.map((achievement) => {
    const Icon = achievement.icon;
    const isUnlocked = unlocked.includes(achievement.key);
    const canUnlock = achievement.eligible(stats, profile);
    return <article key={achievement.key} className={`panel hover-card rounded-2xl p-5 ${isUnlocked ? "border-amber-300/20" : ""}`}><div className="flex items-start gap-4"><div className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${isUnlocked ? "bg-amber-300/10 text-amber-300" : "bg-violet-300/10 text-violet-300"}`}><Icon size={22} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{achievement.title}</h2><span className="rounded-md bg-violet-400/[.08] px-1.5 py-0.5 text-[10px] font-semibold text-violet-200">+{achievement.xp} XP</span></div><p className="mt-1.5 text-xs leading-5 text-[#85869a]">{achievement.detail}</p><div className="mt-4">{isUnlocked ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300"><Trophy size={14} />Freigeschaltet</span> : canUnlock ? <button onClick={() => onUnlock(achievement.key)} className="rounded-lg bg-violet-400/10 px-3 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-400/20">Belohnung abholen</button> : <span className="text-[11px] text-[#696b7f]">Noch nicht erreicht</span>}</div></div></div></article>;
  })}</div></div>;
}

function RanksPage({ totalXP, homework, grades, studySessions }: {
  totalXP: number;
  homework: Homework[];
  grades: Grade[];
  studySessions: StudySession[];
}) {
  const level = currentLevel(totalXP);
  const currentRank = rankForLevel(level);
  const nextRank = rankTiers.find((rank) => rank.minLevel > level);
  const xpToNextRank = nextRank ? Math.max(0, (nextRank.minLevel - 1) * 100 - totalXP) : 0;
  const subjectProgress = new Map<string, { subject: string; xp: number }>();
  const addSubjectXP = (subject: string, xp: number) => {
    const key = subject.trim().toLocaleLowerCase("de-DE");
    if (!key) return;
    const existing = subjectProgress.get(key);
    subjectProgress.set(key, { subject: existing?.subject ?? subject.trim(), xp: (existing?.xp ?? 0) + xp });
  };
  studySessions.forEach((item) => addSubjectXP(item.subject, item.minutes));
  grades.forEach((item) => addSubjectXP(item.subject, item.xp_earned));
  homework.forEach((item) => {
    if (item.completed_at) addSubjectXP(item.subject, 50);
    else addSubjectXP(item.subject, 0);
  });
  const subjectRanks = [...subjectProgress.values()].sort((a, b) => b.xp - a.xp || a.subject.localeCompare(b.subject, "de"));
  return <div className="space-y-5">
    <PageIntro icon={ShieldCheck} title="Ränge" description="Sieh deinen Fortschritt und alle erreichbaren Ränge." />
    <section className="space-y-4">
      <PageIntro icon={BookOpen} title="Deine Fachränge" description="Jedes Fach entwickelt sich durch Lernzeit, Noten und erledigte Aufgaben ganz individuell." />
      {subjectRanks.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {subjectRanks.map(({ subject, xp }) => {
          const subjectXPPerLevel = 20;
          const subjectLevel = Math.min(100, Math.floor(xp / subjectXPPerLevel) + 1);
          const subjectRank = rankForLevel(subjectLevel);
          const nextSubjectRank = rankTiers.find((rank) => rank.minLevel > subjectLevel);
          const progress = subjectLevel === 100 ? 100 : xp % subjectXPPerLevel / subjectXPPerLevel * 100;
          const xpToNextSubjectRank = nextSubjectRank ? Math.max(0, (nextSubjectRank.minLevel - 1) * subjectXPPerLevel - xp) : 0;
          return <article key={subject} className="panel rounded-2xl p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate font-semibold">{subject}</h3>
                <p className="mt-1 text-xs text-[#85869a]">Level {subjectLevel} · {xp.toLocaleString("de-DE")} XP</p>
              </div>
              <span className="shrink-0 rounded-md bg-violet-400/15 px-2 py-1 text-xs font-semibold text-violet-200">{subjectRank}</span>
            </div>
            <div className="progress-track mt-4 h-2 overflow-hidden rounded-full">
              <div className="progress-fill h-full rounded-full transition-all duration-700" style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 flex justify-between gap-3 text-[11px] text-[#838498]">
              <span>{subjectLevel === 100 ? "Maximallevel erreicht" : `${xp % subjectXPPerLevel} / ${subjectXPPerLevel} XP bis Level ${subjectLevel + 1}`}</span>
              <span className="shrink-0">{nextSubjectRank ? `${xpToNextSubjectRank} XP bis ${nextSubjectRank.name}` : "Meister"}</span>
            </div>
          </article>;
        })}
      </div> : <div className="panel rounded-2xl p-5 text-sm text-[#85869a]">Sobald du Lernzeit erfasst, Noten einträgst oder Aufgaben einem Fach zuordnest, erscheint hier dein erster Fachrang.</div>}
    </section>
    <section className="panel relative overflow-hidden rounded-2xl p-5 sm:p-6">
      <div className="pointer-events-none absolute -right-10 -top-20 h-56 w-56 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="relative flex flex-wrap items-center justify-between gap-5">
        <div><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#898a9f]">Dein aktueller Rang</p><h2 className="display-font mt-2 text-3xl font-bold text-violet-200">{currentRank}</h2><p className="mt-1 text-sm text-[#9293a5]">Level {level} · {totalXP.toLocaleString("de-DE")} XP</p></div>
        <div className="rounded-xl border border-white/[.07] bg-black/15 px-4 py-3 text-sm">
          {nextRank ? <><div className="text-[#9293a5]">Noch bis {nextRank.name}</div><div className="mt-1 font-bold text-violet-200">{xpToNextRank.toLocaleString("de-DE")} XP</div></> : <><div className="text-amber-200">Höchster Rang erreicht</div><div className="mt-1 font-bold text-white">Du bist ein Meister!</div></>}
        </div>
      </div>
      <p className="relative mt-5 border-t border-white/[.06] pt-4 text-xs leading-5 text-[#85869a]">Jeden Tag um 00:00 UTC werden automatisch 4 XP abgezogen. Wenn die App geschlossen ist, werden fehlende Tage beim nächsten Öffnen nachgeholt; dein XP-Stand fällt nie unter 0.</p>
    </section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rankTiers.map((rank, index) => {
        const isCurrent = currentRank === rank.name;
        const isReached = level >= rank.minLevel;
        const xpNeeded = (rank.minLevel - 1) * 100;
        return <article key={rank.name} className={`panel rounded-2xl p-4 sm:p-5 ${isCurrent ? "border-violet-300/30 ring-1 ring-violet-300/10" : ""}`}>
          <div className="flex items-start justify-between gap-3">
            <div className={`grid h-11 w-11 place-items-center rounded-xl ${rank.name === "Meister" ? "bg-amber-300/10 text-amber-300" : isReached ? "bg-violet-400/10 text-violet-300" : "bg-white/[.04] text-[#66687d]"}`}><ShieldCheck size={21} /></div>
            <span className={`rounded-md px-2 py-1 text-[10px] font-semibold ${isCurrent ? "bg-violet-400/15 text-violet-200" : isReached ? "bg-emerald-400/10 text-emerald-300" : "bg-white/[.04] text-[#77798b]"}`}>{isCurrent ? "Dein Rang" : isReached ? "Erreicht" : "Gesperrt"}</span>
          </div>
          <h3 className="display-font mt-4 text-xl font-bold">{rank.name}</h3>
          <p className="mt-1 text-xs text-[#85869a]">Level {rank.minLevel}–{rank.maxLevel}</p>
          <p className="mt-3 text-[11px] text-[#77798b]">Ab {xpNeeded.toLocaleString("de-DE")} XP</p>
          {index === rankTiers.length - 1 && <p className="mt-3 border-t border-amber-300/10 pt-3 text-[11px] font-medium text-amber-200">Höchster Rang · Level 100 ist das Maximallevel</p>}
        </article>;
      })}
    </section>
  </div>;
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Zap; label: string; value: string; accent: "violet" | "blue" | "green" | "amber" }) {
  const colors = { violet: "bg-violet-400/10 text-violet-300", blue: "bg-sky-400/10 text-sky-300", green: "bg-emerald-400/10 text-emerald-300", amber: "bg-amber-400/10 text-amber-300" };
  return <div className="panel hover-card rounded-2xl p-4 sm:p-5"><div className="flex items-center justify-between"><span className="text-xs text-[#8b8c9f]">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-xl ${colors[accent]}`}><Icon size={16} /></span></div><div className="display-font mt-3 text-2xl font-bold tracking-tight">{value}</div></div>;
}
function SectionHeading({ icon: Icon, title, subtitle }: { icon: typeof Target; title: string; subtitle: string }) {
  return <div className="flex items-center gap-3"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-400/10 text-violet-300"><Icon size={17} /></div><div className="min-w-0"><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 truncate text-[11px] text-[#838498]">{subtitle}</p></div></div>;
}
function PageIntro({ icon: Icon, title, description, action }: { icon: typeof Activity; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-3"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><Icon size={21} /></div><div><h2 className="display-font text-xl font-bold">{title}</h2><p className="mt-1 text-xs text-[#85869a]">{description}</p></div></div>{action}</div>;
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-[#b2b1c0]">{label}</span>{children}</label>;
}
function PrimaryButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2.5 text-xs font-bold shadow-lg shadow-violet-950/20 hover:brightness-110">{children}</button>;
}
function FormSubmit({ children }: { children: ReactNode }) {
  return <button type="submit" className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-3 text-sm font-bold shadow-lg shadow-violet-950/20 hover:brightness-110">{children}<ChevronRight size={16} /></button>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><div role="dialog" aria-modal="true" aria-labelledby="modal-title" className="panel max-h-[92vh] w-full overflow-y-auto rounded-t-3xl p-5 sm:max-w-lg sm:rounded-3xl sm:p-6"><div className="mb-5 flex items-center justify-between"><h2 id="modal-title" className="display-font text-lg font-bold">{title}</h2><button onClick={onClose} className="rounded-lg p-2 text-[#88899c] hover:bg-white/5 hover:text-white" aria-label="Schließen"><X size={18} /></button></div>{children}</div></div>;
}
function EmptyState({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-white/[.08] p-4"><span className="text-xs text-[#898a9d]">{text}</span><button onClick={onClick} className="text-xs font-semibold text-violet-300 hover:text-violet-200">{action} +</button></div>;
}
function EmptyLarge({ title, detail, action, onClick }: { title: string; detail: string; action: string; onClick: () => void }) {
  return <div className="grid min-h-52 place-items-center p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-violet-400/10 text-violet-300"><ScrollText size={22} /></div><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-1.5 text-xs text-[#85869a]">{detail}</p><button onClick={onClick} className="mt-4 rounded-xl bg-violet-400/10 px-4 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-400/20">{action}</button></div></div>;
}
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-white/10 bg-[#181927] px-3 py-2 shadow-xl"><div className="text-[10px] text-[#9697aa]">{label}</div><div className="mt-1 text-xs font-bold text-violet-200">{payload[0].value} XP</div></div>;
}
function formatMinutes(minutes: number) { return minutes < 60 ? `${minutes} Min.` : `${Math.floor(minutes / 60)} Std. ${minutes % 60 ? `${minutes % 60} Min.` : ""}`.trim(); }

export default App;
