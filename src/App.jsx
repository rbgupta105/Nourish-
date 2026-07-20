import React, { useState, useEffect, useMemo } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Camera, Type, Utensils, ClipboardList, BarChart3, User, Plus,
  Trash2, Loader2, TrendingUp, TrendingDown, Minus, X, Check,
  Flame, Trophy, Dumbbell, Wheat, Droplet, AlertCircle, Home, Activity, Sparkles
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts";

// ---------- Design tokens ----------
const C = {
  bgTop: "#EEEEEC",
  bgBottom: "#F7F6F3",
  ink: "#15171B",
  inkSoft: "#8B8D93",
  card: "#FFFFFF",
  orange: "#EE6C37",
  orangeDeep: "#D85A28",
  orangeTint: "#FCE9E0",
  track: "#E9E4DA",
  green: "#2F6B4F",
  purple: "#8B7FD1",
  purpleTint: "#EFEBFB",
  tan: "#E3A23A",
  tanTint: "#FBEFDC",
  pink: "#E0577F",
  pinkTint: "#FCE7EE",
  blue: "#5B8DBF",
  blueTint: "#E6EEF6",
  line: "#EAE8E3",
};

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDateTime = (d) => new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Night";
}
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// ---------- Storage helpers ----------
// NOTE: window.storage.get/set is an API only available inside Claude.ai Artifacts.
// This standalone project uses the browser's localStorage instead, with the same shape.
async function loadKey(key, fallback) {
  try { const raw = localStorage.getItem(key); if (raw == null) return fallback; return JSON.parse(raw); }
  catch { return fallback; }
}
async function saveKey(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// ---------- Gemini API ----------

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function callGemini(contentBlocks) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash"
  });

  const result = await model.generateContent(contentBlocks);

  const response = await result.response;

  return response.text();
}
function parseJSON(raw) {
  let cleaned = raw.trim().replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  const first = cleaned.indexOf("{"); const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) cleaned = cleaned.slice(first, last + 1);
  return JSON.parse(cleaned);
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("Could not read image file"));
    r.readAsDataURL(file);
  });
}

function buildMealPrompt({ mode, description, goals, todayTotals, todayLogs }) {
  const g = goals, t = todayTotals;
  const mealsText = (todayLogs && todayLogs.length)
    ? todayLogs.map((l) => `- ${l.food_name || "meal"} (${l.estimated_portion || "portion unspecified"}): ${Math.round(num(l.calories))} kcal, ${Math.round(num(l.protein_g))}g protein, ${Math.round(num(l.carbs_g))}g carbs, ${Math.round(num(l.fat_g))}g fat`).join("\n")
    : "No meals logged yet today.";
  return `You are the nutrition estimation and portion-coaching engine inside a meal-logging app. Estimate the nutritional content of the meal ${mode === "photo" ? "shown in the photo" : "described by the user"}, then advise on portion size.

User's daily goals: ${g.calories} kcal, ${g.protein}g protein, ${g.carbs}g carbs, ${g.fat}g fat.
Already logged today before this meal (totals): ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat.
Individual meals logged today so far:
${mealsText}
${mode === "text" ? `Meal description: "${description}"` : ""}

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "food_name": string,
  "estimated_portion": string,
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "fiber_g": number,
  "sugar_g": number,
  "sodium_mg": number,
  "micronutrients": [{"name": string, "amount": string, "percent_dv": number_or_null}],
  "confidence": "high" | "medium" | "low",
  "portion_verdict": "decrease" | "keep" | "increase",
  "portion_change_percent": number,
  "portion_guidance": string
}
Give 3 to 6 notable micronutrients. Weigh both the remaining daily targets AND the composition of meals already logged today (e.g. flag it if today's meals are already carb-heavy or protein-light) when deciding portion_verdict. portion_change_percent is your best-guess recommended change to THIS portion, as a signed integer percent (e.g. -25 to shrink by a quarter, 0 to keep as-is, 15 to grow it) — it must be consistent with portion_verdict. Keep portion_guidance to one or two direct sentences, plain and specific, referencing what's driving the recommendation.`;
}

function buildPortionAdvicePrompt({ pending, goals, todayTotals, todayLogs }) {
  const g = goals, t = todayTotals;
  const mealsText = (todayLogs && todayLogs.length)
    ? todayLogs.map((l) => `- ${l.food_name || "meal"} (${l.estimated_portion || "portion unspecified"}): ${Math.round(num(l.calories))} kcal, ${Math.round(num(l.protein_g))}g protein, ${Math.round(num(l.carbs_g))}g carbs, ${Math.round(num(l.fat_g))}g fat`).join("\n")
    : "No meals logged yet today.";
  return `You are a nutrition portion-coaching engine inside a meal-logging app. The user has manually entered a meal with known nutrition values below — do NOT re-estimate the nutrition, only advise on the portion size.

Meal as entered: ${pending.food_name || "meal"}${pending.estimated_portion ? ` (${pending.estimated_portion})` : ""}: ${num(pending.calories)} kcal, ${num(pending.protein_g)}g protein, ${num(pending.carbs_g)}g carbs, ${num(pending.fat_g)}g fat.

User's daily goals: ${g.calories} kcal, ${g.protein}g protein, ${g.carbs}g carbs, ${g.fat}g fat.
Already logged today before this meal (totals): ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat.
Individual meals logged today so far:
${mealsText}

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "portion_verdict": "decrease" | "keep" | "increase",
  "portion_change_percent": number,
  "portion_guidance": string
}
Weigh both the remaining daily targets AND the composition of meals already logged today. portion_change_percent is a signed integer percent consistent with portion_verdict. Keep portion_guidance to one or two direct, specific sentences.`;
}

function buildExercisePrompt({ entry, history }) {
  const detail = entry.type === "strength"
    ? entry.sets.map((s, i) => `Set ${i + 1}: ${s.weight || 0}kg x ${s.reps || 0} reps`).join("\n")
    : `Duration: ${entry.duration_min || 0} min\nDistance: ${entry.distance_km || 0} km\nPerceived effort: ${entry.effort || "moderate"}`;
  const histText = history.length
    ? history.map((h) => `${h.date}: ` + (h.type === "strength"
        ? h.sets.map((s) => `${s.weight}kg x ${s.reps}`).join(", ")
        : `${h.duration_min}min / ${h.distance_km}km (${h.effort})`)).join("\n")
    : "No previous sessions logged for this exercise.";
  return `You are a fitness coaching assistant embedded in a workout-logging app. Analyze this exercise entry and give specific, useful feedback.

Exercise: ${entry.name} (${entry.type})
${detail}

Recent history for this same exercise (oldest to most recent):
${histText}

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "muscle_groups": [string, ...],
  "estimated_calories": number,
  "volume_assessment": string,
  "progression_suggestion": string,
  "form_tip": string,
  "trend": "improving" | "maintaining" | "declining" | "new"
}
Make progression_suggestion concrete and numeric where possible (a specific weight/rep or pace target for next session). Keep form_tip to one practical cue. Use "new" for trend only if there is no prior history.`;
}

// ---------- Ring ----------
function Ring({ size, stroke, pct, trackColor, fillColor, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamp(pct, 0, 100) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={fillColor} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset .5s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

function Avatar({ initial, size = 46 }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: C.ink, border: "2.5px solid #fff", boxShadow: "0 0 0 1.5px " + C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="ft-display" style={{ color: "#fff", fontSize: size * 0.42, fontWeight: 700 }}>{initial}</span>
      </div>
      {["#F4C94F", "#E85B4B", "#4FA36C"].map((clr, i) => (
        <div key={i} style={{ position: "absolute", right: -2, top: size * 0.18 + i * (size * 0.24), width: 6, height: 6, borderRadius: "50%", background: clr }} />
      ))}
    </div>
  );
}

function GuidanceIcon({ text }) {
  const t = (text || "").toLowerCase();
  if (t.includes("decrease") || t.includes("smaller") || t.includes("shrink") || t.includes("reduce"))
    return <TrendingDown size={16} color={C.pink} />;
  if (t.includes("increase") || t.includes("larger") || t.includes("grow") || t.includes("more"))
    return <TrendingUp size={16} color={C.green} />;
  return <Minus size={16} color={C.orange} />;
}

function TrendBadge({ trend }) {
  if (!trend) return null;
  const map = {
    improving: { color: C.green, bg: "#E4F1EA", icon: TrendingUp, label: "Improving" },
    maintaining: { color: C.tan, bg: C.tanTint, icon: Minus, label: "Maintaining" },
    declining: { color: C.pink, bg: C.pinkTint, icon: TrendingDown, label: "Declining" },
    new: { color: C.blue, bg: C.blueTint, icon: Sparkles, label: "New" },
  };
  const m = map[trend] || map.new;
  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: m.bg, borderRadius: 20 }}>
      <m.icon size={11} color={m.color} />
      <span className="ft-body" style={{ fontSize: 10.5, fontWeight: 600, color: m.color }}>{m.label}</span>
    </div>
  );
}

function PortionBadge({ verdict, percent }) {
  if (!verdict) return null;
  const map = {
    decrease: { color: C.pink, bg: C.pinkTint, icon: TrendingDown, label: "Shrink portion" },
    increase: { color: C.green, bg: "#E4F1EA", icon: TrendingUp, label: "Grow portion" },
    keep: { color: C.tan, bg: C.tanTint, icon: Minus, label: "Keep as-is" },
  };
  const m = map[verdict] || map.keep;
  const pct = num(percent);
  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: m.bg, borderRadius: 20 }}>
      <m.icon size={11} color={m.color} />
      <span className="ft-body" style={{ fontSize: 10.5, fontWeight: 600, color: m.color }}>{m.label}{pct !== 0 ? ` · ${pct > 0 ? "+" : ""}${pct}%` : ""}</span>
    </div>
  );
}

function NutritionLabel({ data, editable, onChange }) {
  const row = (label, key, unit) => (
    <div className="flex items-center justify-between py-1" style={{ borderTop: `1px solid ${C.line}` }}>
      <span className="ft-body" style={{ fontSize: 13, color: C.ink }}>{label}</span>
      {editable ? (
        <input type="number" value={data[key]} onChange={(e) => onChange(key, e.target.value)} className="ft-mono text-right"
          style={{ width: 64, fontSize: 13, background: "transparent", border: "none", color: C.ink, outline: "none" }} />
      ) : (<span className="ft-mono" style={{ fontSize: 13, color: C.ink }}>{data[key]}{unit}</span>)}
    </div>
  );
  return (
    <div className="p-4" style={{ background: C.card, border: `2px solid ${C.ink}`, borderRadius: 16 }}>
      <div className="ft-display" style={{ fontSize: 19, fontWeight: 700, color: C.ink }}>Nutrition Facts</div>
      <div style={{ borderTop: `7px solid ${C.ink}`, marginTop: 4 }} />
      <div className="flex items-baseline justify-between pt-1">
        <span className="ft-body font-semibold" style={{ fontSize: 14, color: C.ink }}>Calories</span>
        {editable ? (
          <input type="number" value={data.calories} onChange={(e) => onChange("calories", e.target.value)} className="ft-mono text-right"
            style={{ width: 80, fontSize: 25, fontWeight: 700, background: "transparent", border: "none", color: C.orange, outline: "none" }} />
        ) : (<span className="ft-mono" style={{ fontSize: 25, fontWeight: 700, color: C.orange }}>{data.calories}</span>)}
      </div>
      <div style={{ borderTop: `4px solid ${C.ink}` }} />
      {row("Protein", "protein_g", "g")}{row("Carbohydrates", "carbs_g", "g")}{row("Fiber", "fiber_g", "g")}
      {row("Sugar", "sugar_g", "g")}{row("Fat", "fat_g", "g")}{row("Sodium", "sodium_mg", "mg")}
      {Array.isArray(data.micronutrients) && data.micronutrients.length > 0 && (
        <div style={{ borderTop: `4px solid ${C.ink}`, marginTop: 4, paddingTop: 4 }}>
          {data.micronutrients.map((m, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>{m.name}</span>
              <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{m.amount}{m.percent_dv != null ? ` · ${m.percent_dv}% DV` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MacroPill({ icon: Icon, iconBg, iconColor, label, value, unit }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1.5 py-3 px-2" style={{ background: C.card, borderRadius: 22, boxShadow: "0 1px 3px rgba(20,20,20,0.06)" }}>
      <div style={{ width: 34, height: 34, borderRadius: "50%", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={iconColor} />
      </div>
      <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 500 }}>{label}</span>
      <span className="ft-display" style={{ fontSize: 16, fontWeight: 700, color: C.green }}>{value}{unit}</span>
    </div>
  );
}

function NavBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2">
      <Icon size={18} strokeWidth={active ? 2.4 : 1.8} color={active ? C.orange : C.inkSoft} />
      <span className="ft-body" style={{ fontSize: 10, color: active ? C.orange : C.inkSoft, fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button onClick={onClick} className="px-3.5 py-1.5 rounded-full ft-body"
      style={{ background: active ? C.ink : C.card, color: active ? "#fff" : C.inkSoft, fontSize: 12.5, fontWeight: 600 }}>
      {label}
    </button>
  );
}

function EmptyState({ text, compact }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: compact ? "20px 0" : "40px 0" }}>
      <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>{text}</span>
    </div>
  );
}

// ---------- Main App ----------
export default function MealTracker() {
  const [tab, setTab] = useState("home");
  const [ready, setReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addLogType, setAddLogType] = useState("meal");
  const [addMode, setAddMode] = useState("photo");
  const [logsSubTab, setLogsSubTab] = useState("meals");
  const [chartsSubTab, setChartsSubTab] = useState("nutrition");

  const [profile, setProfile] = useState({ name: "" });
  const [goals, setGoals] = useState({ calories: 2000, protein: 120, carbs: 220, fat: 65 });
  const [logs, setLogs] = useState([]);
  const [weights, setWeights] = useState([]);
  const [exerciseLogs, setExerciseLogs] = useState([]);

  useEffect(() => {
    (async () => {
      const [p, g, l, w, e] = await Promise.all([
        loadKey("profile", { name: "" }),
        loadKey("goals", { calories: 2000, protein: 120, carbs: 220, fat: 65 }),
        loadKey("meal-logs", []),
        loadKey("weight-logs", []),
        loadKey("exercise-logs", []),
      ]);
      setProfile(p); setGoals(g); setLogs(l); setWeights(w); setExerciseLogs(e); setReady(true);
    })();
  }, []);

  const todayLogs = useMemo(() => logs.filter((l) => l.date === todayStr()), [logs]);
  const todayTotals = useMemo(() => todayLogs.reduce((acc, l) => ({
    calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 }), [todayLogs]);

  const streak = useMemo(() => {
    const dates = new Set(logs.map((l) => l.date));
    let s = 0; let d = new Date();
    if (!dates.has(todayStr())) d.setDate(d.getDate() - 1);
    while (dates.has(d.toISOString().slice(0, 10))) { s++; d.setDate(d.getDate() - 1); }
    return s;
  }, [logs]);

  const weekExercise = useMemo(() => {
    const cutoff = daysAgo(6);
    const inWeek = exerciseLogs.filter((e) => e.date >= cutoff);
    const sessions = new Set(inWeek.map((e) => e.date)).size;
    const volume = inWeek.reduce((sum, e) => e.type === "strength" ? sum + e.sets.reduce((s, x) => s + num(x.weight) * num(x.reps), 0) : sum, 0);
    return { sessions, volume: Math.round(volume) };
  }, [exerciseLogs]);

  async function persistLogs(next) { setLogs(next); await saveKey("meal-logs", next); }
  async function persistWeights(next) { setWeights(next); await saveKey("weight-logs", next); }
  async function persistGoals(next) { setGoals(next); await saveKey("goals", next); }
  async function persistProfile(next) { setProfile(next); await saveKey("profile", next); }
  async function persistExercise(next) { setExerciseLogs(next); await saveKey("exercise-logs", next); }

  async function deleteLog(id) { await persistLogs(logs.filter((l) => l.id !== id)); }
  async function deleteExercise(id) { await persistExercise(exerciseLogs.filter((e) => e.id !== id)); }

  function openAdd(logType, mode) { setAddLogType(logType); setAddMode(mode || "photo"); setShowAdd(true); }

  const last14 = useMemo(() => {
    const days = []; for (let i = 13; i >= 0; i--) days.push(daysAgo(i));
    return days.map((date) => {
      const dayLogs = logs.filter((l) => l.date === date);
      const t = dayLogs.reduce((acc, l) => ({ calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g), carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g) }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      const dayEx = exerciseLogs.filter((e) => e.date === date);
      const volume = dayEx.reduce((sum, e) => e.type === "strength" ? sum + e.sets.reduce((s, x) => s + num(x.weight) * num(x.reps), 0) : sum, 0);
      const burned = dayEx.reduce((sum, e) => sum + num(e.ai && e.ai.estimated_calories), 0);
      return { date: fmtDate(date), ...t, volume: Math.round(volume), burned: Math.round(burned) };
    });
  }, [logs, exerciseLogs]);
  const weightSeries = useMemo(() => [...weights].sort((a, b) => a.timestamp - b.timestamp).map((w) => ({ date: fmtDate(w.date), weight: w.weight })), [weights]);

  if (!ready) return <div className="flex items-center justify-center" style={{ height: 700, background: C.bgTop }}><Loader2 className="animate-spin" size={22} color={C.orange} /></div>;

  const initial = profile.name ? profile.name.trim()[0].toUpperCase() : "U";
  const eatenPct = goals.calories > 0 ? (todayTotals.calories / goals.calories) * 100 : 0;
  const remaining = Math.max(0, Math.round(goals.calories - todayTotals.calories));

  return (
    <div className="flex flex-col relative" style={{ height: 700, maxHeight: "100vh", background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, overflow: "hidden" }}>
            <div className="flex-1 overflow-y-auto px-4 pt-5" style={{ paddingBottom: 90 }}>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Avatar initial={initial} />
            <div>
              <div className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 500 }}>{greeting()}</div>
              {profile.name ? (
                <div className="ft-display" style={{ fontSize: 19, fontWeight: 700, color: C.ink }}>{profile.name}</div>
              ) : (
                <input value={profile.name} onChange={(e) => persistProfile({ ...profile, name: e.target.value })} placeholder="Add your name"
                  className="ft-display" style={{ fontSize: 16, fontWeight: 700, color: C.inkSoft, background: "transparent", border: "none", outline: "none" }} />
              )}
            </div>
          </div>
          <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Nourish</span>
        </div>

        {tab === "home" && (
          <>
            <div className="p-5 mb-4" style={{ background: C.card, borderRadius: 28, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center justify-between">
                <Ring size={190} stroke={16} pct={eatenPct} trackColor={C.track} fillColor={C.orange}>
                  <div className="flex flex-col items-center">
                    <span className="ft-display" style={{ fontSize: 34, fontWeight: 700, color: C.ink }}>{remaining}</span>
                    <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 500 }}>kcal left</span>
                  </div>
                </Ring>
                <div className="flex flex-col gap-4 pl-2">
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Flame size={16} color={C.orange} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{Math.round(todayTotals.calories)}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>/ {goals.calories} kcal goal</div></div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: "#E4F1EA", display: "flex", alignItems: "center", justifyContent: "center" }}><ClipboardList size={16} color={C.green} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{todayLogs.length}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>meals logged</div></div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trophy size={16} color={C.pink} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{streak}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>day streak</div></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 mb-6">
              <MacroPill icon={Dumbbell} iconBg={C.purpleTint} iconColor={C.purple} label="Protein" value={Math.round(todayTotals.protein)} unit="g" />
              <MacroPill icon={Wheat} iconBg={C.tanTint} iconColor={C.tan} label="Carbs" value={Math.round(todayTotals.carbs)} unit="g" />
              <MacroPill icon={Droplet} iconBg={C.pinkTint} iconColor={C.pink} label="Fat" value={Math.round(todayTotals.fat)} unit="g" />
            </div>

            <div className="ft-body mb-3" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Log your meal</div>
            <div className="p-4 mb-5" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center gap-1.5 mb-4">
                <Flame size={14} color={C.orange} />
                <span className="ft-body" style={{ fontSize: 11.5, fontWeight: 700, color: C.orange, letterSpacing: 0.5, textTransform: "uppercase" }}>Calories remaining</span>
              </div>
              <div className="flex items-center justify-between">
                {[{ key: "photo", label: "Photo", icon: Camera }, { key: "text", label: "Describe", icon: Type }, { key: "manual", label: "Manual", icon: Utensils }].map((opt) => (
                  <button key={opt.key} onClick={() => openAdd("meal", opt.key)} className="flex flex-col items-center gap-1.5">
                    <div style={{ width: 62, height: 62, borderRadius: "50%", border: `2px dashed ${C.track}`, display: "flex", alignItems: "center", justifyContent: "center" }}><opt.icon size={20} color={C.inkSoft} /></div>
                    <span className="ft-body" style={{ fontSize: 11, color: C.inkSoft, fontWeight: 500 }}>{opt.label}</span>
                  </button>
                ))}
                <Ring size={78} stroke={7} pct={eatenPct} trackColor={C.track} fillColor={C.green}>
                  <div className="flex flex-col items-center"><span className="ft-mono" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{remaining}</span><span className="ft-body" style={{ fontSize: 8.5, color: C.inkSoft }}>KCAL</span></div>
                </Ring>
              </div>
            </div>

            <div className="ft-body mb-3" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Log a workout</div>
            <div className="p-4 mb-2" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div style={{ width: 42, height: 42, borderRadius: 14, background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Dumbbell size={19} color={C.blue} /></div>
                  <div>
                    <div className="ft-display" style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{weekExercise.sessions} sessions</div>
                    <div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>{weekExercise.volume} kg volume · last 7 days</div>
                  </div>
                </div>
              </div>
              <button onClick={() => openAdd("exercise")} className="w-full flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.ink, color: "#fff", fontSize: 13.5, fontWeight: 600 }}>
                <Plus size={16} /> Log exercise
              </button>
            </div>
          </>
        )}

        {tab === "logs" && (
          <div>
            <div className="flex gap-2 mb-4">
              <Chip active={logsSubTab === "meals"} onClick={() => setLogsSubTab("meals")} label={`Meals (${logs.length})`} />
              <Chip active={logsSubTab === "exercise"} onClick={() => setLogsSubTab("exercise")} label={`Exercise (${exerciseLogs.length})`} />
            </div>
            {logsSubTab === "meals" ? (
              logs.length === 0 ? <EmptyState text="Nothing logged yet. Tap the orange + button to add your first meal." /> : (
                <div className="flex flex-col gap-2.5">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between p-3.5" style={{ background: C.card, borderRadius: 18, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Utensils size={15} color={C.orange} /></div>
                        <div className="min-w-0">
                          <div className="ft-body" style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.food_name}</div>
                          <div className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>{fmtDateTime(l.timestamp)} · {Math.round(l.calories)} kcal · P{Math.round(l.protein_g)} C{Math.round(l.carbs_g)} F{Math.round(l.fat_g)}</div>
                        </div>
                      </div>
                      <button onClick={() => deleteLog(l.id)} className="p-2 flex-shrink-0"><Trash2 size={14} color={C.pink} /></button>
                    </div>
                  ))}
                </div>
              )
            ) : (
              exerciseLogs.length === 0 ? <EmptyState text="No workouts logged yet. Tap the orange + button and choose Exercise." /> : (
                <div className="flex flex-col gap-2.5">
                  {exerciseLogs.map((e) => {
                    const volume = e.type === "strength" ? e.sets.reduce((s, x) => s + num(x.weight) * num(x.reps), 0) : 0;
                    return (
                      <div key={e.id} className="p-3.5" style={{ background: C.card, borderRadius: 18, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {e.type === "strength" ? <Dumbbell size={15} color={C.blue} /> : <Activity size={15} color={C.blue} />}
                            </div>
                            <div className="min-w-0">
                              <div className="ft-body" style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{e.name}</div>
                              <div className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>
                                {fmtDateTime(e.timestamp)} · {e.type === "strength" ? `${e.sets.length} sets · ${Math.round(volume)} kg volume` : `${e.duration_min}min · ${e.distance_km}km`}
                              </div>
                            </div>
                          </div>
                          <button onClick={() => deleteExercise(e.id)} className="p-2 flex-shrink-0"><Trash2 size={14} color={C.pink} /></button>
                        </div>
                        {e.ai && (
                          <div className="mt-2.5 pt-2.5" style={{ borderTop: `1px solid ${C.line}` }}>
                            <div className="flex items-center justify-between mb-1.5">
                              <TrendBadge trend={e.ai.trend} />
                              <span className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>~{e.ai.estimated_calories} kcal burned</span>
                            </div>
                            <div className="ft-body" style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}>{e.ai.progression_suggestion}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>
        )}

        {tab === "charts" && (
          <div>
            <div className="flex gap-2 mb-4">
              <Chip active={chartsSubTab === "nutrition"} onClick={() => setChartsSubTab("nutrition")} label="Nutrition" />
              <Chip active={chartsSubTab === "exercise"} onClick={() => setChartsSubTab("exercise")} label="Exercise" />
            </div>

            {chartsSubTab === "nutrition" ? (
              <>
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Calories vs. goal</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={last14}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                      <Bar dataKey="calories" fill={C.orange} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Macros (g/day)</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={last14}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="protein" stroke={C.purple} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="carbs" stroke={C.tan} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="fat" stroke={C.pink} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="p-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Weight</div>
                  {weightSeries.length === 0 ? <EmptyState text="Log a weight entry in Profile to see your trend." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <LineChart data={weightSeries}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} domain={["dataMin - 2", "dataMax + 2"]} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                        <Line type="monotone" dataKey="weight" stroke={C.ink} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Training volume (kg/day)</div>
                  {exerciseLogs.length === 0 ? <EmptyState text="Log a workout to see your volume trend." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={last14}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                        <Bar dataKey="volume" fill={C.blue} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="p-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Estimated calories burned</div>
                  {exerciseLogs.length === 0 ? <EmptyState text="Get AI feedback on a workout to estimate calories burned." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={last14}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}` }} />
                        <Bar dataKey="burned" fill={C.pink} radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {tab === "profile" && <ProfilePanel goals={goals} onSaveGoals={persistGoals} weights={weights}
          onAddWeight={async (w) => { const entry = { id: uid(), date: todayStr(), timestamp: Date.now(), weight: w }; await persistWeights([entry, ...weights.filter((x) => x.date !== todayStr())]); }}
          onDeleteWeight={async (id) => persistWeights(weights.filter((w) => w.id !== id))} />}
      </div>

      <div className="absolute left-4 right-4 bottom-4 flex items-center" style={{ background: C.card, borderRadius: 30, boxShadow: "0 6px 20px rgba(20,20,20,0.14)", height: 64 }}>
        <NavBtn active={tab === "home"} onClick={() => setTab("home")} icon={Home} label="Home" />
        <NavBtn active={tab === "logs"} onClick={() => setTab("logs")} icon={ClipboardList} label="Logs" />
        <div style={{ width: 60 }} />
        <NavBtn active={tab === "charts"} onClick={() => setTab("charts")} icon={BarChart3} label="Insights" />
        <NavBtn active={tab === "profile"} onClick={() => setTab("profile")} icon={User} label="Profile" />
      </div>
      <button onClick={() => openAdd("meal", "photo")} className="absolute flex items-center justify-center"
        style={{ left: "50%", transform: "translateX(-50%)", bottom: 46, width: 58, height: 58, borderRadius: "50%", background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})`, boxShadow: "0 6px 16px rgba(238,108,55,0.45)" }}>
        <Plus size={26} color="#fff" strokeWidth={2.4} />
      </button>

      {showAdd && (
        <AddLogSheet
          initialLogType={addLogType} initialMode={addMode} goals={goals} todayTotals={todayTotals} todayLogs={todayLogs} exerciseLogs={exerciseLogs}
          onClose={() => setShowAdd(false)}
          onSaveMeal={async (entry) => { await persistLogs([entry, ...logs]); setShowAdd(false); }}
          onSaveExercise={async (entry) => { await persistExercise([entry, ...exerciseLogs]); setShowAdd(false); }}
        />
      )}
    </div>
  );
}

// ---------- Add Log Sheet (Meal or Exercise) ----------
function AddLogSheet({ initialLogType, initialMode, goals, todayTotals, todayLogs, exerciseLogs, onClose, onSaveMeal, onSaveExercise }) {
  const [logType, setLogType] = useState(initialLogType);

  return (
    <div className="absolute inset-0 flex flex-col justify-end" style={{ background: "rgba(21,23,27,0.4)" }} onClick={onClose}>
      <div className="flex flex-col" style={{ background: C.bgBottom, borderRadius: "28px 28px 0 0", maxHeight: "90%", boxShadow: "0 -8px 30px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="ft-display" style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>Add a log</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} color={C.ink} /></button>
        </div>
        <div className="px-5 pt-1 pb-2">
          <div className="flex gap-2">
            <button onClick={() => setLogType("meal")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: logType === "meal" ? C.orange : C.card, color: logType === "meal" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}>
              <Utensils size={15} /> Meal
            </button>
            <button onClick={() => setLogType("exercise")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: logType === "exercise" ? C.blue : C.card, color: logType === "exercise" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}>
              <Dumbbell size={15} /> Exercise
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 pb-6">
          {logType === "meal"
            ? <MealForm initialMode={initialMode} goals={goals} todayTotals={todayTotals} todayLogs={todayLogs} onSave={onSaveMeal} />
            : <ExerciseForm exerciseLogs={exerciseLogs} onSave={onSaveExercise} />}
        </div>
      </div>
    </div>
  );
}

const EMPTY_MEAL = { food_name: "", estimated_portion: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, micronutrients: [], confidence: "manual", portion_verdict: null, portion_change_percent: 0, portion_guidance: "" };

function MealForm({ initialMode, goals, todayTotals, todayLogs, onSave }) {
  const [mode, setMode] = useState(initialMode === "manual" ? "text" : initialMode);
  const [imagePreview, setImagePreview] = useState(null);
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(initialMode === "manual" ? { ...EMPTY_MEAL } : null);
  const [photoInputId] = useState(() => "meal-photo-" + uid());

  async function handleImagePick(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null); setPending(null);
    const b64 = await fileToBase64(file);
    setImagePreview({ b64, mediaType: file.type || "image/jpeg" });
  }

  async function analyze() {
    setError(null); setPending(null);
    if (mode === "photo" && !imagePreview) { setError("Add a photo first."); return; }
    if (mode === "text" && description.trim().length < 2) { setError("Describe what you ate first."); return; }
    setAnalyzing(true);
    try {
      const promptText = buildMealPrompt({ mode, description, goals, todayTotals, todayLogs });
      const blocks = mode === "photo"
        ? [{ type: "image", source: { type: "base64", media_type: imagePreview.mediaType, data: imagePreview.b64 } }, { type: "text", text: promptText }]
        : [{ type: "text", text: promptText }];
      const raw = await callgemini(blocks);
      const parsed = parseJSON(raw);
      setPending({
        food_name: parsed.food_name || (mode === "text" ? description : "Logged meal"),
        estimated_portion: parsed.estimated_portion || "",
        calories: num(parsed.calories), protein_g: num(parsed.protein_g), carbs_g: num(parsed.carbs_g), fat_g: num(parsed.fat_g),
        fiber_g: num(parsed.fiber_g), sugar_g: num(parsed.sugar_g), sodium_mg: num(parsed.sodium_mg),
        micronutrients: Array.isArray(parsed.micronutrients) ? parsed.micronutrients : [],
        confidence: parsed.confidence || "medium",
        portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent),
        portion_guidance: parsed.portion_guidance || "",
      });
    } catch (e) {
      setError((e && e.message ? e.message : "Couldn't analyze that meal") + " — enter it manually below.");
      setPending({ ...EMPTY_MEAL, food_name: mode === "text" ? description : "Logged meal" });
    } finally { setAnalyzing(false); }
  }

  async function getPortionAdvice() {
    if (!pending || !pending.food_name || !pending.calories) { setError("Fill in the meal name and calories first."); return; }
    setError(null); setAdvising(true);
    try {
      const promptText = buildPortionAdvicePrompt({ pending, goals, todayTotals, todayLogs });
      const raw = await callgemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      setPending((p) => ({ ...p, portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent), portion_guidance: parsed.portion_guidance || "" }));
    } catch (e) {
      setError(e && e.message ? e.message : "Couldn't get portion guidance.");
    } finally { setAdvising(false); }
  }

  function updateField(key, value) { setPending((p) => ({ ...p, [key]: key === "food_name" || key === "estimated_portion" ? value : num(value) })); }

  async function save() {
    if (!pending || !pending.food_name) { setError("Give the meal a name."); return; }
    await onSave({ id: uid(), date: todayStr(), timestamp: Date.now(), source: mode, ...pending });
  }

  return (
    <>
      {!pending && (
        <>
          <div className="flex gap-2 mb-3 mt-1">
            <button onClick={() => { setMode("photo"); setError(null); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: mode === "photo" ? C.ink : C.card, color: mode === "photo" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}><Camera size={15} /> Photo</button>
            <button onClick={() => { setMode("text"); setError(null); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: mode === "text" ? C.ink : C.card, color: mode === "text" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}><Type size={15} /> Describe</button>
          </div>
          {mode === "photo" ? (
            <div className="mb-3">
              <input id={photoInputId} type="file" accept="image/*" capture="environment" onChange={handleImagePick} className="hidden" />
              {imagePreview ? (
                <div className="relative">
                  <img src={`data:${imagePreview.mediaType};base64,${imagePreview.b64}`} alt="Meal preview" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 16 }} />
                  <button onClick={() => setImagePreview(null)} className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(21,23,27,0.7)" }}><X size={14} color="#fff" /></button>
                </div>
              ) : (
                <label htmlFor={photoInputId} className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl cursor-pointer" style={{ border: `2px dashed ${C.track}`, background: C.card }}>
                  <Camera size={22} color={C.orange} /><span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>Tap to add a photo</span>
                </label>
              )}
            </div>
          ) : (
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. grilled chicken breast, half cup rice, side of steamed broccoli"
              className="w-full p-3 rounded-2xl ft-body mb-3" style={{ border: "none", background: C.card, fontSize: 14, minHeight: 90, resize: "none", outline: "none" }} />
          )}
          {error && (<div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.pinkTint }}><AlertCircle size={15} color={C.pink} style={{ flexShrink: 0, marginTop: 1 }} /><span className="ft-body" style={{ fontSize: 12, color: C.pink }}>{error}</span></div>)}
          <button onClick={analyze} disabled={analyzing} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body" style={{ background: C.ink, color: "#fff", fontSize: 14, fontWeight: 600, opacity: analyzing ? 0.7 : 1 }}>
            {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Utensils size={16} />}{analyzing ? "Analyzing meal…" : "Analyze meal"}
          </button>
          <button onClick={() => setPending({ ...EMPTY_MEAL })}
            className="w-full flex items-center justify-center py-2.5 mt-2 ft-body" style={{ color: C.inkSoft, fontSize: 12.5, fontWeight: 500 }}>Skip — enter nutrition manually</button>
        </>
      )}
      {pending && (
        <div>
          <input value={pending.food_name} onChange={(e) => updateField("food_name", e.target.value)} placeholder="Meal name" className="w-full ft-display mb-1"
            style={{ fontSize: 18, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none", borderBottom: `1px solid ${C.line}`, paddingBottom: 4 }} />
          {pending.estimated_portion && <div className="ft-body mb-3" style={{ fontSize: 12, color: C.inkSoft }}>{pending.estimated_portion}</div>}
          {pending.portion_guidance ? (
            <div className="flex items-start gap-2 p-3 mb-3 rounded-xl" style={{ background: C.orangeTint }}>
              <div style={{ marginTop: 1 }}><GuidanceIcon text={pending.portion_guidance} /></div>
              <div className="flex-1">
                <div className="mb-1"><PortionBadge verdict={pending.portion_verdict} percent={pending.portion_change_percent} /></div>
                <span className="ft-body" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.4 }}>{pending.portion_guidance}</span>
              </div>
            </div>
          ) : (
            pending.food_name && pending.calories > 0 && (
              <button onClick={getPortionAdvice} disabled={advising} className="w-full flex items-center justify-center gap-2 py-2.5 mb-3 rounded-xl ft-body"
                style={{ background: C.orangeTint, color: C.orangeDeep, fontSize: 12.5, fontWeight: 600, opacity: advising ? 0.7 : 1 }}>
                {advising ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}{advising ? "Thinking…" : "Get AI portion guidance"}
              </button>
            )
          )}
          <NutritionLabel data={pending} editable onChange={updateField} />
          {error && <div className="ft-body mt-2" style={{ fontSize: 12, color: C.pink }}>{error}</div>}
          <div className="flex gap-2 mt-3">
            <button onClick={() => setPending(null)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.card, color: C.ink, fontSize: 14, fontWeight: 600 }}><X size={16} /> Back</button>
            <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> Save log</button>
          </div>
        </div>
      )}
    </>
  );
}

function ExerciseForm({ exerciseLogs, onSave }) {
  const [exType, setExType] = useState("strength");
  const [name, setName] = useState("");
  const [sets, setSets] = useState([{ weight: "", reps: "" }]);
  const [durationMin, setDurationMin] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [effort, setEffort] = useState("moderate");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [ai, setAi] = useState(null);
  const [saved, setSaved] = useState(false);

  function updateSet(i, key, value) { setSets((s) => s.map((row, idx) => idx === i ? { ...row, [key]: value } : row)); }
  function addSet() { setSets((s) => [...s, { weight: s[s.length - 1] ? s[s.length - 1].weight : "", reps: "" }]); }
  function removeSet(i) { setSets((s) => s.filter((_, idx) => idx !== i)); }

  function buildEntry() {
    return exType === "strength"
      ? { name: name.trim(), type: "strength", sets: sets.map((s) => ({ weight: num(s.weight), reps: num(s.reps) })) }
      : { name: name.trim(), type: "cardio", duration_min: num(durationMin), distance_km: num(distanceKm), effort };
  }

  async function getFeedback() {
    setError(null); setAi(null);
    if (!name.trim()) { setError("Name the exercise first."); return; }
    if (exType === "strength" && sets.every((s) => !num(s.weight) && !num(s.reps))) { setError("Add at least one set."); return; }
    if (exType === "cardio" && !num(durationMin)) { setError("Add a duration."); return; }
    setAnalyzing(true);
    try {
      const entry = buildEntry();
      const history = exerciseLogs.filter((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase()).slice(0, 5).reverse();
      const raw = await callgemini([{ type: "text", text: buildExercisePrompt({ entry, history }) }]);
      const parsed = parseJSON(raw);
      setAi({
        muscle_groups: Array.isArray(parsed.muscle_groups) ? parsed.muscle_groups : [],
        estimated_calories: num(parsed.estimated_calories),
        volume_assessment: parsed.volume_assessment || "",
        progression_suggestion: parsed.progression_suggestion || "",
        form_tip: parsed.form_tip || "",
        trend: parsed.trend || "new",
      });
    } catch (e) {
      setError((e && e.message ? e.message : "Couldn't get feedback") + " — you can still save this workout.");
    } finally { setAnalyzing(false); }
  }

  async function save() {
    if (!name.trim()) { setError("Name the exercise first."); return; }
    const entry = { id: uid(), date: todayStr(), timestamp: Date.now(), ...buildEntry(), ai };
    await onSave(entry);
  }

  return (
    <div>
      <div className="flex gap-2 mb-3 mt-1">
        <button onClick={() => setExType("strength")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
          style={{ background: exType === "strength" ? C.ink : C.card, color: exType === "strength" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}><Dumbbell size={15} /> Strength</button>
        <button onClick={() => setExType("cardio")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
          style={{ background: exType === "cardio" ? C.ink : C.card, color: exType === "cardio" ? "#fff" : C.ink, fontSize: 13, fontWeight: 600 }}><Activity size={15} /> Cardio</button>
      </div>

      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={exType === "strength" ? "e.g. Bench press" : "e.g. Running"}
        className="w-full p-3 rounded-2xl ft-body mb-3" style={{ border: "none", background: C.card, fontSize: 14, outline: "none" }} />

      {exType === "strength" ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="ft-body" style={{ fontSize: 11.5, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Sets</span>
            <span className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>kg × reps</span>
          </div>
          <div className="flex flex-col gap-2">
            {sets.map((s, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5" style={{ background: C.card, borderRadius: 16 }}>
                <span className="ft-mono" style={{ fontSize: 11, color: C.inkSoft, width: 16 }}>{i + 1}</span>
                <input type="number" inputMode="decimal" value={s.weight} onChange={(e) => updateSet(i, "weight", e.target.value)} placeholder="Weight"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, borderRadius: 10, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
                <span className="ft-body" style={{ color: C.inkSoft, fontSize: 12 }}>×</span>
                <input type="number" inputMode="numeric" value={s.reps} onChange={(e) => updateSet(i, "reps", e.target.value)} placeholder="Reps"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, borderRadius: 10, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
                {sets.length > 1 && <button onClick={() => removeSet(i)}><X size={14} color={C.inkSoft} /></button>}
              </div>
            ))}
          </div>
          <button onClick={addSet} className="flex items-center gap-1.5 mt-2 ft-body" style={{ color: C.blue, fontSize: 12.5, fontWeight: 600 }}><Plus size={14} /> Add set</button>
        </div>
      ) : (
        <div className="mb-3">
          <div className="flex gap-2 mb-2">
            <input type="number" inputMode="decimal" value={durationMin} onChange={(e) => setDurationMin(e.target.value)} placeholder="Duration (min)"
              className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, fontSize: 13, outline: "none" }} />
            <input type="number" inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="Distance (km)"
              className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, fontSize: 13, outline: "none" }} />
          </div>
          <div className="flex gap-2">
            {["light", "moderate", "vigorous"].map((lvl) => (
              <button key={lvl} onClick={() => setEffort(lvl)} className="flex-1 py-2 rounded-full ft-body capitalize"
                style={{ background: effort === lvl ? C.blue : C.card, color: effort === lvl ? "#fff" : C.inkSoft, fontSize: 12, fontWeight: 600 }}>{lvl}</button>
            ))}
          </div>
        </div>
      )}

      {error && (<div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.pinkTint }}><AlertCircle size={15} color={C.pink} style={{ flexShrink: 0, marginTop: 1 }} /><span className="ft-body" style={{ fontSize: 12, color: C.pink }}>{error}</span></div>)}

      {!ai && (
        <button onClick={getFeedback} disabled={analyzing} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body mb-2" style={{ background: C.blue, color: "#fff", fontSize: 14, fontWeight: 600, opacity: analyzing ? 0.7 : 1 }}>
          {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}{analyzing ? "Analyzing…" : "Get AI feedback"}
        </button>
      )}

      {ai && (
        <div className="p-4 mb-3" style={{ background: C.card, borderRadius: 18 }}>
          <div className="flex items-center justify-between mb-2">
            <TrendBadge trend={ai.trend} />
            <span className="ft-mono" style={{ fontSize: 11, color: C.inkSoft }}>~{ai.estimated_calories} kcal</span>
          </div>
          {ai.muscle_groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {ai.muscle_groups.map((m, i) => (
                <span key={i} className="ft-body px-2 py-1" style={{ background: C.blueTint, color: C.blue, borderRadius: 20, fontSize: 10.5, fontWeight: 600 }}>{m}</span>
              ))}
            </div>
          )}
          {ai.volume_assessment && <div className="ft-body mb-2" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.4 }}>{ai.volume_assessment}</div>}
          {ai.progression_suggestion && (
            <div className="flex items-start gap-2 p-2.5 mb-2 rounded-xl" style={{ background: C.orangeTint }}>
              <TrendingUp size={14} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} />
              <span className="ft-body" style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}>{ai.progression_suggestion}</span>
            </div>
          )}
          {ai.form_tip && <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, lineHeight: 1.4, fontStyle: "italic" }}>Cue: {ai.form_tip}</div>}
        </div>
      )}

      <div className="flex gap-2">
        {ai && <button onClick={() => setAi(null)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.card, color: C.ink, fontSize: 14, fontWeight: 600 }}><X size={16} /> Redo</button>}
        <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.blue, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> Save workout</button>
      </div>
      {!ai && <div className="ft-body text-center mt-2" style={{ fontSize: 11.5, color: C.inkSoft }}>You can save without AI feedback too.</div>}
    </div>
  );
}

function ProfilePanel({ goals, onSaveGoals, weights, onAddWeight, onDeleteWeight }) {
  const [local, setLocal] = useState(goals);
  const [saved, setSaved] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  useEffect(() => setLocal(goals), [goals]);

  function field(key, label, unit) {
    return (
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{label}</span>
          <span className="ft-mono" style={{ fontSize: 11, color: C.inkSoft }}>{unit}</span>
        </div>
        <input type="number" value={local[key]} onChange={(e) => { setLocal((p) => ({ ...p, [key]: num(e.target.value) })); setSaved(false); }}
          className="w-full p-3 rounded-2xl ft-mono" style={{ border: "none", background: C.card, fontSize: 16, outline: "none" }} />
      </div>
    );
  }

  return (
    <div>
      <div className="ft-body mb-3" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Daily goals</div>
      {field("calories", "Calories", "kcal")}{field("protein", "Protein", "g")}{field("carbs", "Carbohydrates", "g")}{field("fat", "Fat", "g")}
      <button onClick={async () => { await onSaveGoals(local); setSaved(true); }} className="w-full flex items-center justify-center gap-2 py-3 rounded-full ft-body mb-6"
        style={{ background: saved ? C.track : C.orange, color: saved ? C.ink : "#fff", fontSize: 14, fontWeight: 600 }}>{saved ? <><Check size={16} /> Saved</> : "Save goals"}</button>

      <div className="ft-body mb-3" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Weight</div>
      <div className="flex gap-2 mb-4">
        <input type="number" inputMode="decimal" value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder="Today's weight"
          className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, fontSize: 14, outline: "none" }} />
        <button onClick={() => { const w = num(weightInput, null); if (w) { onAddWeight(w); setWeightInput(""); } }} className="flex items-center justify-center px-4 rounded-2xl" style={{ background: C.orange }}><Plus size={18} color="#fff" /></button>
      </div>
      {weights.length === 0 ? <EmptyState text="No weight entries yet." /> : (
        <div className="flex flex-col gap-2">
          {[...weights].sort((a, b) => b.timestamp - a.timestamp).map((w) => (
            <div key={w.id} className="flex items-center justify-between p-3 rounded-2xl" style={{ background: C.card }}>
              <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>{fmtDate(w.date)}</span>
              <span className="ft-mono" style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{w.weight}</span>
              <button onClick={() => onDeleteWeight(w.id)} className="p-1.5"><Trash2 size={14} color={C.pink} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
