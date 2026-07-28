import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  signInWithPopup,
  signInWithCredential,
  GoogleAuthProvider,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";
import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { auth, googleProvider, db } from "./firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";

import {
  Camera, Type, Utensils, ClipboardList, BarChart3, User, Plus,
  Trash2, Loader2, TrendingUp, TrendingDown, Minus, X, Check,
  Flame, Trophy, Dumbbell, Wheat, Droplet, AlertCircle, Home, Activity, Sparkles,
  Star, Pencil, Copy, Droplets, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Gauge,
  Bell, Award, Layers, Brain, Lightbulb, Mic, ScanBarcode, ThumbsUp, ThumbsDown,
  Moon, BedDouble, AlarmClock, Sunrise, Scale, Leaf, Cloud
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine
} from "recharts";

// ---------- Design tokens ----------
const LIGHT = {
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
  greenTint: "#E4F1EA",
  line: "#EAE8E3",
  onInk: "#FFFFFF", // text/icon color safe to place on top of a C.ink-colored background
};

const DARK = {
  bgTop: "#0F1115",
  bgBottom: "#1A1D23",
  ink: "#FFFFFF",
  inkSoft: "#A8ADB8",
  card: "#23262D",
  orange: "#EE6C37",
  orangeDeep: "#D85A28",
  orangeTint: "#3A2A22",
  track: "#3A3D44",
  green: "#4CAF50",
  purple: "#9B8CFF",
  purpleTint: "#2C2545",
  tan: "#D9A441",
  tanTint: "#3A3120",
  pink: "#FF7DA4",
  pinkTint: "#3A2330",
  blue: "#6FA8FF",
  blueTint: "#23344D",
  greenTint: "#1E3A2A",
  line: "#3A3D44",
  onInk: "#15171B", // in dark mode C.ink is white, so text on it must be dark to stay legible
};

let C = LIGHT;

// ---------- Default workout split ----------
// A starting Push/Pull/Legs/Shoulders template — fully editable per day. Each day
// is just a name + an ordered list of planned exercise names; nothing forces a
// day's exercises to actually get logged (unlogged ones are simply left empty).
const DEFAULT_SPLITS = [
  {
    id: "default-ppl", name: "Push Pull Legs",
    days: [
      { id: "d1", label: "Push", exercises: ["Bench press", "Overhead press", "Incline dumbbell press", "Tricep pushdown"] },
      { id: "d2", label: "Pull", exercises: ["Deadlift", "Pull-ups", "Barbell row", "Bicep curl"] },
      { id: "d3", label: "Legs", exercises: ["Squat", "Leg press", "Romanian deadlift", "Calf raise"] },
      { id: "d4", label: "Shoulders", exercises: ["Overhead press", "Lateral raise", "Face pull", "Shrugs"] },
    ],
  },
];


const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
// Local-calendar-day date string (was previously toISOString(), which is UTC and
// drifts a full day off the user's actual local date depending on timezone/time).
const localDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => localDateStr(new Date());
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
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }
// Inverse of daysAgo: how many days before today a given local "YYYY-MM-DD"
// date string falls (0 = today, 1 = yesterday, etc). Used by the calendar
// jump-to-date control on the Home dashboard.
function offsetFromDateStr(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((today - target) / 86400000);
}
const fmtTime = (d) => new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
// Meal-time-of-day label, purely derived from the logged timestamp (no field for
// this is stored) — used to give meal cards a friendly "Lunch"/"Dinner" heading.
function mealPeriodLabel(timestamp) {
  const h = new Date(timestamp).getHours();
  if (h < 11) return "Breakfast";
  if (h < 16) return "Lunch";
  if (h < 19) return "Snack";
  return "Dinner";
}
// Very small keyword → emoji lookup so a meal card can show a quick visual
// summary of what was eaten without needing per-item structured data.
const FOOD_EMOJI_RULES = [
  [/rice/i, "🍚"], [/dal|lentil/i, "🥣"], [/paneer|cottage cheese/i, "🧀"], [/cheese/i, "🧀"],
  [/chicken/i, "🍗"], [/egg/i, "🥚"], [/roti|chapati|naan|paratha|bread|toast/i, "🍞"],
  [/salad|spinach|greens|veg(etable)?s?/i, "🥗"], [/fruit|apple|banana|mango|berry|orange/i, "🍎"],
  [/fish|salmon|tuna/i, "🐟"], [/milk|yogurt|curd|dahi/i, "🥛"], [/oats?|cereal|porridge|muesli/i, "🥣"],
  [/potato|aloo/i, "🥔"], [/curry|gravy|sabzi/i, "🍛"], [/soup/i, "🍲"], [/pasta|noodle/i, "🍝"],
  [/coffee|tea|chai/i, "☕"], [/juice|smoothie|shake/i, "🥤"], [/beef|mutton|meat/i, "🥩"],
  [/pizza/i, "🍕"], [/burger/i, "🍔"], [/nuts?|almond|peanut|cashew/i, "🥜"], [/beans|chickpea|chole|rajma/i, "🫘"],
];
function foodEmoji(name) {
  for (const [re, emoji] of FOOD_EMOJI_RULES) if (re.test(name)) return emoji;
  return "🍽️";
}
// Splits a free-text meal name like "Rice, Dal, Paneer" into individual items so
// the meal card can show "🍚 Rice · 🥣 Dal · 🧀 Paneer" instead of one flat line.
function splitFoodItems(foodName) {
  if (!foodName) return [];
  return foodName.split(/,|&|\+| and /i).map((s) => s.trim()).filter(Boolean).slice(0, 4);
}
// Weekday check on a "YYYY-MM-DD" local date string (Mon-Fri). Parses components
// manually (not `new Date(dateStr)`) to avoid that string being read as UTC midnight.
function isWeekday(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, day).getDay();
  return dow >= 1 && dow <= 5;
}
// Sunday is treated as a rest/holiday day for gym & workout tracking — a missed
// Sunday shouldn't read as a "skipped" workout day anywhere in the app.
function isSundayDate(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, day).getDay() === 0;
}
// ---------- Sleep helpers ----------
// Minutes between a "HH:MM" bedtime and "HH:MM" wake time, wrapping past midnight
// (e.g. 22:45 -> 07:00 is a valid ~8h15m night, not a negative duration).
function sleepDurationMinutes(bedtime, wakeTime) {
  const [bh, bm] = (bedtime || "0:0").split(":").map(Number);
  const [wh, wm] = (wakeTime || "0:0").split(":").map(Number);
  let diff = (wh * 60 + wm) - (bh * 60 + bm);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}
function fmtSleepDuration(mins) {
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return `${h}h ${m}m`;
}
function fmtTime12(hhmm) {
  const [h, m] = (hhmm || "0:0").split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
// Fallback sleep-goal target (minutes) used only if the user hasn't set
// their own value in Profile > Daily goals (goals.sleep) — same role as the
// hardcoded fallbacks already used for fiber/water elsewhere.
const SLEEP_GOAL_MINUTES = 480;
// Simple, deterministic thresholds (not an AI judgment) driving the calm
// "good sleep glow" / "poor sleep" cues — relative to the user's own sleep
// goal (falling back to the 8h default) rather than a fixed assumption:
// within 30min of goal or more reads as good, more than 2h short reads as
// poor, anything between is neutral.
function sleepQuality(mins, goalMinutes = SLEEP_GOAL_MINUTES) {
  if (!mins || mins <= 0) return "none";
  if (mins >= goalMinutes - 30) return "good";
  if (mins < goalMinutes - 120) return "poor";
  return "ok";
}
// Eases a sleep duration (in minutes) up from 0 once on mount, formatted the
// same way as the rest of the app (fmtSleepDuration) — used for the Home
// tile's "counts up" moment. Deliberately self-contained (not reused inside
// the interactive SleepDial) since that number needs to track live drag
// input instantly rather than animate on every small change.
function SleepDurationCountUp({ minutes, duration = 800 }) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current, to = minutes;
    let raf; const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [minutes, duration]);
  return <>{fmtSleepDuration(Math.round(display))}</>;
}

// ---------- Weight pace projection ----------
// Least-squares slope (kg/day) over the most recent entries (last 42 days, or all
// entries if fewer than that span exists). Returns null if there isn't enough data.
function computeWeightPace(weights) {
  const sorted = [...weights].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length < 2) return null;
  const cutoff = Date.now() - 42 * 86400000;
  const windowed = sorted.filter((w) => w.timestamp >= cutoff);
  const pts = windowed.length >= 2 ? windowed : sorted;
  const t0 = pts[0].timestamp;
  const xs = pts.map((p) => (p.timestamp - t0) / 86400000);
  const ys = pts.map((p) => num(p.weight));
  const n = pts.length;
  const sumX = xs.reduce((a, b) => a + b, 0), sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slopePerDay = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  return {
    currentWeight: ys[ys.length - 1],
    paceKgPerWeek: slopePerDay * 7,
    pointsUsed: n,
  };
}

function projectWeeksToGoal(currentWeight, goalWeight, paceKgPerWeek) {
  if (!goalWeight || Math.abs(paceKgPerWeek) < 0.01) return null;
  const remaining = goalWeight - currentWeight;
  const weeks = remaining / paceKgPerWeek;
  if (weeks <= 0) return { onTrack: false };
  return { onTrack: true, weeks: Math.round(weeks * 10) / 10 };
}

// ---------- Insight callouts ----------
// Small set of deterministic, locally-computed observations (no AI call) drawn
// from logged meals/workouts vs. the user's goals.
function generateInsights(logs, exerciseLogs, goals) {
  const insights = [];
  const cutoff = daysAgo(27); // trailing 4-week window keeps insights recent but not noisy
  const recentLogs = logs.filter((l) => l.date >= cutoff);

  // 1) Weekday vs weekend protein pattern
  const weekdayP = recentLogs.filter((l) => isWeekday(l.date));
  const weekendP = recentLogs.filter((l) => !isWeekday(l.date));
  const avgProteinByDay = (arr) => {
    const byDate = {};
    arr.forEach((l) => { byDate[l.date] = (byDate[l.date] || 0) + num(l.protein_g); });
    const vals = Object.values(byDate);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const wdAvg = avgProteinByDay(weekdayP), weAvg = avgProteinByDay(weekendP);
  if (wdAvg != null && weAvg != null && wdAvg < weAvg * 0.85 && wdAvg < goals.protein * 0.9) {
    insights.push({
      icon: Dumbbell, color: C.purple, bg: C.purpleTint,
      text: `Consistently low on protein on weekdays — averaging ${Math.round(wdAvg)}g vs ${Math.round(weAvg)}g on weekends.`,
    });
  }

  // 2) Calorie average vs goal over the last 14 logged days
  const last14Dates = [...new Set(recentLogs.map((l) => l.date))].sort().slice(-14);
  if (last14Dates.length >= 4 && goals.calories > 0) {
    const byDate = {};
    recentLogs.forEach((l) => { if (last14Dates.includes(l.date)) byDate[l.date] = (byDate[l.date] || 0) + num(l.calories); });
    const vals = Object.values(byDate);
    const avgCal = vals.reduce((a, b) => a + b, 0) / vals.length;
    const pctOff = (avgCal - goals.calories) / goals.calories;
    if (Math.abs(pctOff) >= 0.15) {
      insights.push({
        icon: Flame, color: C.orange, bg: C.orangeTint,
        text: `Averaging ${Math.round(avgCal)} kcal/day over your last ${vals.length} logged days — about ${Math.round(Math.abs(pctOff) * 100)}% ${pctOff > 0 ? "above" : "below"} your ${goals.calories} kcal goal.`,
      });
    }
  }

  // 3) Workout frequency trend: this week vs. the week before
  const thisWeekStart = daysAgo(6), lastWeekStart = daysAgo(13), lastWeekEnd = daysAgo(7);
  const thisWeekSessions = new Set(exerciseLogs.filter((e) => e.date >= thisWeekStart).map((e) => e.date)).size;
  const lastWeekSessions = new Set(exerciseLogs.filter((e) => e.date >= lastWeekStart && e.date <= lastWeekEnd).map((e) => e.date)).size;
  if (lastWeekSessions >= 2 && thisWeekSessions <= Math.max(0, lastWeekSessions - 2)) {
    insights.push({
      icon: TrendingDown, color: C.pink, bg: C.pinkTint,
      text: `Workout frequency dropped — ${thisWeekSessions} session${thisWeekSessions === 1 ? "" : "s"} this week vs ${lastWeekSessions} the week before.`,
    });
  } else if (thisWeekSessions >= 3 && thisWeekSessions > lastWeekSessions) {
    insights.push({
      icon: TrendingUp, color: C.green, bg: C.greenTint,
      text: `Nice consistency — ${thisWeekSessions} workout sessions this week, up from ${lastWeekSessions}.`,
    });
  }

  // 4) Eating-timing pattern: what share of calories land after 8pm
  const totalRecentCals = recentLogs.reduce((s, l) => s + num(l.calories), 0);
  if (totalRecentCals > 0 && recentLogs.length >= 5) {
    const lateCals = recentLogs.filter((l) => new Date(l.timestamp).getHours() >= 20).reduce((s, l) => s + num(l.calories), 0);
    const latePct = Math.round((lateCals / totalRecentCals) * 100);
    if (latePct >= 25) {
      insights.push({
        icon: Moon, color: C.purple, bg: C.purpleTint,
        text: `${latePct}% of your calories come in after 8pm, based on your last ${new Set(recentLogs.map((l) => l.date)).size} logged days.`,
      });
    }
  }

  return insights;
}

// ---------- Weekly / monthly summary ----------
// Averages are computed over the fixed period length (7 or 30 days), not just days
// with entries, so they read as a true daily average for that stretch.
function computePeriodSummary(logs, days) {
  const periodStart = daysAgo(days - 1);
  const prevStart = daysAgo(days * 2 - 1);
  const prevEnd = daysAgo(days);
  const sum = (arr, key) => arr.reduce((a, l) => a + num(l[key]), 0);
  const current = logs.filter((l) => l.date >= periodStart);
  const previous = logs.filter((l) => l.date >= prevStart && l.date <= prevEnd);
  const avg = (arr, key) => arr.length ? sum(arr, key) / days : 0;
  const trend = (curVal, prevVal) => {
    if (prevVal === 0) return curVal === 0 ? "flat" : "up";
    const delta = (curVal - prevVal) / prevVal;
    if (Math.abs(delta) < 0.05) return "flat";
    return delta > 0 ? "up" : "down";
  };
  const curCal = avg(current, "calories"), prevCal = avg(previous, "calories");
  const curP = avg(current, "protein_g"), prevP = avg(previous, "protein_g");
  const curC = avg(current, "carbs_g"), prevC = avg(previous, "carbs_g");
  const curF = avg(current, "fat_g"), prevF = avg(previous, "fat_g");
  return {
    avgCalories: Math.round(curCal),
    avgProtein: Math.round(curP), proteinTrend: trend(curP, prevP),
    avgCarbs: Math.round(curC), carbsTrend: trend(curC, prevC),
    avgFat: Math.round(curF), fatTrend: trend(curF, prevF),
    calorieTrend: trend(curCal, prevCal),
    daysLogged: new Set(current.map((l) => l.date)).size,
  };
}

function TrendArrow({ trend, size = 12 }) {
  if (trend === "up") return <TrendingUp size={size} color={C.green} />;
  if (trend === "down") return <TrendingDown size={size} color={C.pink} />;
  return <Minus size={size} color={C.inkSoft} />;
}

// ---------- Daily Nutrition Score ----------
// Weighted 0-100 score blending how close today is to the calorie/protein/fiber/
// water goals plus a simple "meal consistency" measure (meals logged vs. a
// 3-meals/day target). Weights: calories 25, protein 25, fiber 20, water 15,
// consistency 15.
function computeNutritionScore({ todayTotals, todayLogs, goals, waterMl }) {
  const calScore = goals.calories > 0
    ? clamp(100 - Math.abs((todayTotals.calories - goals.calories) / goals.calories) * 150, 0, 100)
    : 0;
  const proteinScore = goals.protein > 0 ? clamp((todayTotals.protein / goals.protein) * 100, 0, 100) : 0;
  const fiberGoal = goals.fiber || 28;
  const fiberScore = clamp((todayTotals.fiber / fiberGoal) * 100, 0, 100);
  const waterGoal = goals.water || 2000;
  const waterScore = clamp((waterMl / waterGoal) * 100, 0, 100);
  const consistencyScore = clamp((todayLogs.length / 3) * 100, 0, 100);

  const weighted = {
    calories: { score: calScore, weight: 0.25, label: "calorie target" },
    protein: { score: proteinScore, weight: 0.25, label: "protein intake" },
    fiber: { score: fiberScore, weight: 0.20, label: "fiber intake" },
    water: { score: waterScore, weight: 0.15, label: "water intake" },
    consistency: { score: consistencyScore, weight: 0.15, label: "meal consistency" },
  };
  const total = Math.round(Object.values(weighted).reduce((sum, c) => sum + c.score * c.weight, 0));

  const entries = Object.entries(weighted);
  const best = entries.reduce((a, b) => (b[1].score > a[1].score ? b : a));
  const worst = entries.reduce((a, b) => (b[1].score < a[1].score ? b : a));

  const praise = {
    calories: "Right on target with calories.",
    protein: "Great protein intake.",
    fiber: "Solid fiber intake.",
    water: "Well hydrated today.",
    consistency: "Great meal consistency.",
  };
  const fixes = {
    calories: () => `Aim closer to your ${goals.calories} kcal goal.`,
    protein: () => `Add ~${Math.max(0, Math.round(goals.protein - todayTotals.protein))}g more protein.`,
    fiber: () => `Increase fiber by ~${Math.max(0, Math.round(fiberGoal - todayTotals.fiber))}g.`,
    water: () => `Drink ~${Math.max(0, Math.round((waterGoal - waterMl) / 250))} more glass(es) of water.`,
    consistency: () => `Log ${Math.max(0, 3 - todayLogs.length)} more meal(s) today.`,
  };

  const summary = worst[1].score >= 90
    ? `${praise[best[0]]} You're on track across the board.`
    : `${praise[best[0]]} ${fixes[worst[0]]()}`;

  return { total, summary, breakdown: weighted, bestKey: best[0], worstKey: worst[0] };
}

// ---------- Micronutrient tracking ----------
// Fiber and sodium come from the meal's own numeric fields; the rest are
// aggregated from each meal's freeform `micronutrients` %DV list (summed across
// today's meals) since the AI schema doesn't return them as first-class fields.
const MICRO_KEYWORD_DEFS = [
  { key: "calcium", label: "Calcium", match: /calcium/i },
  { key: "iron", label: "Iron", match: /\biron\b/i },
  { key: "b12", label: "Vitamin B12", match: /b[- ]?12/i },
  { key: "vitaminD", label: "Vitamin D", match: /vitamin d\b/i },
  { key: "potassium", label: "Potassium", match: /potassium/i },
];
function computeMicronutrientSummary(todayLogs, goals) {
  const pctTotals = Object.fromEntries(MICRO_KEYWORD_DEFS.map((d) => [d.key, 0]));
  todayLogs.forEach((l) => {
    (Array.isArray(l.micronutrients) ? l.micronutrients : []).forEach((m) => {
      if (m.percent_dv == null || !m.name) return;
      const def = MICRO_KEYWORD_DEFS.find((d) => d.match.test(m.name));
      if (def) pctTotals[def.key] += num(m.percent_dv);
    });
  });
  const fiberGoal = goals.fiber || 28;
  const fiberTotal = todayLogs.reduce((s, l) => s + num(l.fiber_g), 0);
  const sodiumTotal = todayLogs.reduce((s, l) => s + num(l.sodium_mg), 0);
  const sodiumLimit = 2300; // standard daily recommended upper limit
  return [
    { key: "fiber", label: "Fiber", value: Math.round(fiberTotal), unit: "g", pct: clamp((fiberTotal / fiberGoal) * 100, 0, 999), color: C.green },
    { key: "sodium", label: "Sodium", value: Math.round(sodiumTotal), unit: "mg", pct: clamp((sodiumTotal / sodiumLimit) * 100, 0, 999), color: C.pink, capIsLimit: true },
    ...MICRO_KEYWORD_DEFS.map((d) => ({ key: d.key, label: d.label, value: Math.round(pctTotals[d.key]), unit: "% DV", pct: clamp(pctTotals[d.key], 0, 999), color: C.blue, isPct: true })),
  ];
}

// ---------- Weekly goal achievement ----------
// For each of the last 7 local-calendar days, checks whether that day's totals
// landed within a reasonable band of the calorie/protein goals.
function computeWeeklyAchievement(logs, goals) {
  const days = []; for (let i = 6; i >= 0; i--) days.push(daysAgo(i));
  const perDay = days.map((date) => {
    const dayLogs = logs.filter((l) => l.date === date);
    const cal = dayLogs.reduce((s, l) => s + num(l.calories), 0);
    const protein = dayLogs.reduce((s, l) => s + num(l.protein_g), 0);
    const calHit = goals.calories > 0 && cal >= goals.calories * 0.9 && cal <= goals.calories * 1.15;
    const proteinHit = goals.protein > 0 && protein >= goals.protein * 0.9;
    return { date, calHit, proteinHit, hasLogs: dayLogs.length > 0 };
  });
  return {
    perDay,
    caloriesAchieved: perDay.filter((d) => d.calHit).length,
    proteinAchieved: perDay.filter((d) => d.proteinHit).length,
    totalDays: 7,
  };
}

function AchievementBar({ perDay, hitKey }) {
  return (
    <div className="flex gap-1">
      {perDay.map((d, i) => (
        <div key={i} style={{
          flex: 1, height: 8, borderRadius: 4,
          background: d[hitKey] ? C.green : d.hasLogs ? C.pink : C.track,
          opacity: d[hitKey] ? 1 : d.hasLogs ? 0.55 : 0.4,
        }} />
      ))}
    </div>
  );
}

// ---------- Storage helpers ----------
// This project uses the browser's localStorage for local caching, synced to
// Firestore for signed-in users (see syncKeyToCloud / migrateLocalDataToCloud below).
async function loadKey(key, fallback) {
  try { const raw = localStorage.getItem(key); if (raw == null) return fallback; return JSON.parse(raw); }
  catch { return fallback; }
}
async function saveKey(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// ---------- Firestore cloud migration ----------

const NOURISH_CLOUD_KEYS = [
  "profile",
  "meal-logs",
  "weight-logs",
  "water-logs",
  "sleep-logs",
  "favorite-meals",
  "goals",
  "exercise-logs",
  "workout-splits",
  "daily-coach",
  "weekly-review",
  "monthly-review",
];

async function migrateLocalDataToCloud(user) {
  if (!user?.uid) {
    return { success: false, reason: "no-user" };
  }

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  // Never overwrite existing cloud data — instead hand it back so the caller
  // can hydrate localStorage from it (keeps existing cloud data as the source
  // of truth when signing in on a device that already has local data too).
  if (userSnap.exists()) {
    return {
      success: true,
      migrated: false,
      reason: "cloud-exists",
      cloudData: userSnap.data(),
    };
  }

  const localData = {};

  for (const key of NOURISH_CLOUD_KEYS) {
    const value = await loadKey(key, null);

    if (value !== null) {
      localData[key] = value;
    }
  }

  await setDoc(userRef, {
    ...localData,
    cloudVersion: 1,
    migratedFromLocal: true,
    migratedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return {
    success: true,
    migrated: true,
    reason: "local-data-uploaded",
  };
}

// Pulls down whatever's already in the user's cloud doc into localStorage, so
// the very next loadAll() picks it up as if it had always been local.
async function hydrateLocalFromCloud(cloudData) {
  if (!cloudData) return;
  for (const key of NOURISH_CLOUD_KEYS) {
    if (cloudData[key] !== undefined) {
      await saveKey(key, cloudData[key]);
    }
  }
}

// ---------- Offline sync retry queue ----------
// syncKeyToCloud can fail silently when the device has no connectivity — the
// local save (saveKey) still succeeds, but the cloud write is just dropped.
// This queue remembers the latest value per storage key that failed to sync,
// persisted to localStorage so it survives a reload, and retries it once
// connectivity returns (see the "online" listener + flush on sign-in below).
const SYNC_QUEUE_KEY = "nourish-pending-sync";

function readSyncQueue() {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function writeSyncQueue(queue) {
  try { localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue)); } catch {}
}
function queueSyncRetry(key, value) {
  const queue = readSyncQueue();
  queue[key] = value;
  writeSyncQueue(queue);
}
function clearSyncRetry(key) {
  const queue = readSyncQueue();
  if (key in queue) {
    delete queue[key];
    writeSyncQueue(queue);
  }
}

// Ongoing two-way sync: called alongside every saveKey() so signed-in users'
// changes keep flowing up to Firestore, not just on the one-time migration.
async function syncKeyToCloud(user, key, value) {
  if (!user?.uid) return;
  try {
    const userRef = doc(db, "users", user.uid);
    await setDoc(userRef, { [key]: value, updatedAt: serverTimestamp() }, { merge: true });
    clearSyncRetry(key);
  } catch (error) {
    console.error("Nourish cloud sync failed:", key, error);
    queueSyncRetry(key, value);
  }
}

// Retries every key currently queued (called on sign-in and whenever the
// browser/device comes back online). Anything that fails again — e.g. still
// offline — simply stays queued for the next attempt.
async function flushSyncQueue(user) {
  if (!user?.uid) return;
  const queue = readSyncQueue();
  const keys = Object.keys(queue);
  for (const key of keys) {
    await syncKeyToCloud(user, key, queue[key]);
  }
}

// ---------- Gemini API ----------

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Tried in order — if a model's quota/rate limit is hit, the next one in
// the chain is used instead of surfacing an error to the user. Only quota /
// rate-limit style failures fall through like this; any other error (bad
// request, invalid content, etc.) is thrown immediately rather than wasting
// time retrying it against every model in the chain.
const GEMINI_MODEL_FALLBACK_CHAIN = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];

function isGeminiQuotaError(err) {
  const status = err && (err.status || err.code);
  const msg = ((err && err.message) || "").toLowerCase();
  return status === 429 || /quota|rate.?limit|resource.?exhausted|too many requests/.test(msg);
}

async function callGemini(contentBlocks) {
  const parts = contentBlocks.map((block) => {
    if (block.type === "image") {
      return {
        inlineData: {
          mimeType: block.source.media_type,
          data: block.source.data,
        },
      };
    }

    if (block.type === "text") {
      return {
        text: block.text,
      };
    }
  });

  let lastErr;
  for (let i = 0; i < GEMINI_MODEL_FALLBACK_CHAIN.length; i++) {
    try {
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL_FALLBACK_CHAIN[i] });
      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
      });
      return result.response.text();
    } catch (err) {
      lastErr = err;
      const isLastModel = i === GEMINI_MODEL_FALLBACK_CHAIN.length - 1;
      if (isLastModel || !isGeminiQuotaError(err)) throw err;
      // This model's quota/rate limit is hit — fall through to the next
      // model in the chain rather than failing the request.
    }
  }
  throw lastErr;
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

// ---------- Barcode / packaged-food lookup (OpenFoodFacts) ----------
// Free, keyless public database — used as an alternative to AI photo/text
// estimation for packaged foods. A barcode match gives exact label nutrition
// instead of a visual guess, so it's treated as "high confidence" by design.
// Completely separate from the Gemini meal-analysis path above.
function parseServingGrams(servingSize) {
  if (!servingSize) return null;
  const m = String(servingSize).match(/([\d.]+)\s*g\b/i);
  return m ? Number(m[1]) : null;
}
async function lookupBarcodeProduct(code) {
  const trimmed = (code || "").trim();
  if (!trimmed) throw new Error("Enter or scan a barcode number first.");
  let data;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(trimmed)}.json`);
    data = await res.json();
  } catch {
    throw new Error("Couldn't reach the food database — check your connection and try again.");
  }
  if (!data || data.status !== 1 || !data.product) {
    throw new Error("No product found for that barcode. You can log this meal with Photo or Describe instead.");
  }
  const p = data.product;
  const n = p.nutriments || {};
  // OpenFoodFacts reports per-100g (and sometimes per-serving) — standardizing
  // on per-100g here so any quantity the user enters scales consistently.
  return {
    name: p.product_name || p.generic_name || trimmed,
    brand: p.brands || "",
    servingGrams: parseServingGrams(p.serving_size),
    per100g: {
      calories: num(n["energy-kcal_100g"]),
      protein_g: num(n.proteins_100g),
      carbs_g: num(n.carbohydrates_100g),
      fat_g: num(n.fat_100g),
      fiber_g: num(n.fiber_100g),
      sugar_g: num(n.sugars_100g),
      sodium_mg: num(n.sodium_100g) * 1000, // OFF reports sodium in g/100g
    },
  };
}

// ---------- Haptics ----------
// Best-effort tactile feedback for save/delete actions. No-ops silently on
// devices/browsers without the Vibration API (e.g. iOS Safari, desktop).
function haptic(kind = "light") {
  try {
    if (!("vibrate" in navigator)) return;
    const patterns = { light: 12, success: [10, 40, 14], delete: [16, 30, 16], achievement: [14, 30, 14, 30, 22] };
    navigator.vibrate(patterns[kind] ?? 12);
  } catch { /* vibration not supported/allowed — ignore */ }
}

// ---------- Today's Status ----------
// A single, immediately-readable read on "how am I doing today", blended from
// where calories/protein currently sit vs. goal. Used by the dashboard's status
// card so the app leads with an answer rather than a wall of numbers.
function computeTodayStatus({ todayTotals, goals, todayLogs }) {
  const calPct = goals.calories > 0 ? (todayTotals.calories / goals.calories) * 100 : 0;
  const proPct = goals.protein > 0 ? (todayTotals.protein / goals.protein) * 100 : 0;
  const remaining = Math.round(goals.calories - todayTotals.calories);

  if (todayLogs.length === 0) {
    return { level: "empty", emoji: "🍽️", label: "Nothing logged yet", color: C.inkSoft, bg: C.track, calPct, proPct, remaining };
  }
  if (calPct >= 90 && calPct <= 110 && proPct >= 90) {
    return { level: "achieved", emoji: "🏆", label: "Goal achieved", color: C.green, bg: C.greenTint, calPct, proPct, remaining };
  }
  if (calPct > 115 || calPct < 55) {
    return { level: "over", emoji: "🔴", label: calPct > 115 ? "Significantly over" : "Significantly under", color: C.pink, bg: C.pinkTint, calPct, proPct, remaining };
  }
  if (calPct < 80 || proPct < 60) {
    return { level: "low", emoji: "🟡", label: "Slightly low", color: C.tan, bg: C.tanTint, calPct, proPct, remaining };
  }
  return { level: "onTrack", emoji: "🟢", label: "On track today", color: C.green, bg: C.greenTint, calPct, proPct, remaining };
}

// ---------- Weekly Consistency ----------
// Per-day read on adherence (good/ok/off/none) for the last `daysCount` days —
// the same "how close to goal" logic as computeTodayStatus, applied day by day,
// so a week can be scanned at a glance instead of read off a line chart.
// `offsetDays` shifts the whole window further into the past (e.g. 7 to get
// the week before the current one), used to detect week-over-week improvement.
function computeWeeklyConsistency(logs, goals, daysCount = 7, offsetDays = 0) {
  const today = todayStr();
  const days = [];
  for (let i = daysCount - 1; i >= 0; i--) days.push(daysAgo(i + offsetDays));
  return days.map((date) => {
    const dayLogs = logs.filter((l) => l.date === date);
    const totals = dayLogs.reduce((acc, l) => ({
      calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    }), { calories: 0, protein: 0 });
    const calPct = goals.calories > 0 ? (totals.calories / goals.calories) * 100 : 0;
    const proPct = goals.protein > 0 ? (totals.protein / goals.protein) * 100 : 0;
    const isToday = date === today;

    let status;
    if (dayLogs.length === 0) {
      status = isToday ? "pending" : "none";
    } else if (calPct >= 85 && calPct <= 115 && proPct >= 80) {
      status = "good";
    } else if (calPct >= 60 && calPct <= 130) {
      status = "ok";
    } else {
      status = "off";
    }
    // A rough "how much of the day's goal did this hit" fill amount, purely
    // for the bar's fill height — separate from the good/ok/off categorization
    // above (which stays exactly as it was) so the visual can be more granular
    // than the 3-way bucket without changing what counts as "good".
    const fillPct = dayLogs.length === 0 ? 0 : clamp((calPct * 0.6 + Math.min(proPct, 100) * 0.4), 6, 100);

    const weekdayLetter = ["S", "M", "T", "W", "T", "F", "S"][new Date(date + "T00:00:00").getDay()];
    return { date, weekdayLetter, status, isToday, loggedMeals: dayLogs.length, fillPct };
  });
}

// ---------- AI correction learning ----------
// Remembers how a user's manual portion/calorie edits compare to what the AI
// first estimated for a given food, keyed by a loose normalized food name. Fed
// back into future prompts for that food so estimates gradually drift toward the
// user's own typical portions instead of repeating the same miss.
function normalizeFoodKey(name) {
  return (name || "").trim().toLowerCase().replace(/\s+/g, " ");
}
function getPortionMemory(foodName) {
  try {
    const all = JSON.parse(localStorage.getItem("portion-memory") || "{}");
    return all[normalizeFoodKey(foodName)] || null;
  } catch { return null; }
}
function recordPortionCorrection(foodName, { aiPortion, userPortion, aiCalories, userCalories }) {
  const key = normalizeFoodKey(foodName);
  if (!key) return;
  // Only worth remembering if the user actually changed something meaningfully.
  const portionChanged = (aiPortion || "").trim().toLowerCase() !== (userPortion || "").trim().toLowerCase();
  const caloriesChanged = aiCalories > 0 && Math.abs(userCalories - aiCalories) / aiCalories > 0.12;
  if (!portionChanged && !caloriesChanged) return;
  try {
    const all = JSON.parse(localStorage.getItem("portion-memory") || "{}");
    const existing = all[key] || { foodName, corrections: [] };
    existing.foodName = foodName;
    existing.corrections = [{ aiPortion, userPortion, aiCalories, userCalories, timestamp: Date.now() }, ...existing.corrections].slice(0, 5);
    all[key] = existing;
    localStorage.setItem("portion-memory", JSON.stringify(all));
  } catch { /* storage full/unavailable — skip silently */ }
}
// Lightweight "does this look right?" signal — much lower friction than editing
// full numbers, so it's used far more often and gives the learning system a
// steady stream of confirm/deny data points instead of relying only on the
// rarer full manual correction.
function recordQuickFeedback(foodName, { aiPortion, aiCalories }, isAccurate) {
  const key = normalizeFoodKey(foodName);
  if (!key) return;
  try {
    const all = JSON.parse(localStorage.getItem("portion-memory") || "{}");
    const existing = all[key] || { foodName, corrections: [] };
    existing.foodName = foodName;
    // A thumbs-up is stored as a "correction" toward the AI's own number (i.e. a
    // confirmation), which naturally pulls the weighted average back toward
    // "keep doing this" instead of only ever reacting to edits.
    existing.corrections = [{
      aiPortion, userPortion: isAccurate ? aiPortion : "", aiCalories, userCalories: isAccurate ? aiCalories : aiCalories,
      timestamp: Date.now(), confirmed: isAccurate,
    }, ...existing.corrections].slice(0, 5);
    all[key] = existing;
    localStorage.setItem("portion-memory", JSON.stringify(all));
  } catch { /* storage full/unavailable — skip silently */ }
}
// Guesses whether a user's typed portion is weight/volume-based ("180g",
// "1.5 cups") or count-based ("2 rotis", "3 pieces"), so repeated corrections
// can teach which unit style this user actually favors for a given food.
function detectPortionUnitStyle(portionText) {
  const s = (portionText || "").trim().toLowerCase();
  if (!s) return null;
  if (/\d+(\.\d+)?\s*(g|gram|grams|kg|ml|l|litre|liter)\b/.test(s)) return "weight/volume (e.g. grams/ml)";
  if (/\d+(\.\d+)?\s*(piece|pieces|slice|slices|roti|rotis|chapati|chapatis|cup|cups|katori|katoris|bowl|bowls|plate|plates|spoon|spoons|tbsp|tsp)\b/.test(s)) return "count-based (e.g. pieces/cups/bowls)";
  return null;
}
// Turns remembered corrections into a short prompt note. Averages the last few
// corrections with more weight on recent ones (instead of just reacting to the
// single latest edit, which could be an outlier), and also surfaces which
// portion-unit style this user actually favors for the food.
function buildPortionMemoryNote(foodName) {
  const mem = getPortionMemory(foodName);
  if (!mem || mem.corrections.length < 2) return "";
  const weights = [1, 0.7, 0.5, 0.35, 0.25];
  let weightedRatioSum = 0, weightTotal = 0;
  const unitCounts = {};
  mem.corrections.forEach((c, i) => {
    const w = weights[i] ?? 0.15;
    if (c.aiCalories > 0 && c.userCalories > 0) {
      weightedRatioSum += (c.userCalories / c.aiCalories) * w;
      weightTotal += w;
    }
    const unit = detectPortionUnitStyle(c.userPortion);
    if (unit) unitCounts[unit] = (unitCounts[unit] || 0) + w;
  });
  const avgRatio = weightTotal > 0 ? weightedRatioSum / weightTotal : 1;
  const latest = mem.corrections[0];
  const confirmCount = mem.corrections.filter((c) => c.confirmed === true).length;
  const flagCount = mem.corrections.filter((c) => c.confirmed === false).length;
  const preferredUnit = Object.entries(unitCounts).sort((a, b) => b[1] - a[1])[0];

  let note = `\nNote: for "${mem.foodName}", this user's past ${mem.corrections.length} logs (recency-weighted) trend toward about ${Math.round(avgRatio * 100)}% of the AI's initial calorie estimate`;
  if (latest.userPortion) note += `, most recently correcting toward "${latest.userPortion}" (from an initial estimate of ${latest.aiPortion || `~${Math.round(latest.aiCalories)} kcal`})`;
  note += `. Lean toward this user's typical portion size for this food unless the current photo/description clearly indicates otherwise — but weigh it as a trend across recent logs, not a single fixed override.`;
  if (preferredUnit) note += ` This user typically reports this food's portion as ${preferredUnit[0]} — phrase "estimated_portion" in that style when reasonable.`;
  if (confirmCount) note += ` They've also confirmed the AI's estimate as accurate ${confirmCount} time(s) without changes.`;
  if (flagCount) note += ` They've flagged the AI's estimate as inaccurate ${flagCount} time(s) without giving a specific correction — treat this food's estimate with extra caution and lean conservative.`;
  return note;
}

// ---------- Image compression ----------
// Downscales + re-encodes a photo client-side before it's sent to Gemini, cutting
// upload size/time and token cost. Longest side is capped and JPEG quality kept
// fairly high (0.82) so food detail the model relies on isn't degraded.
function compressImageFile(file, { maxDimension = 1280, quality = 0.82 } = {}) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          const scale = maxDimension / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        URL.revokeObjectURL(url);
        resolve({ b64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image file")); };
    img.src = url;
  });
}

function buildMealPrompt({ mode, description, goals, todayTotals, todayLogs, portionMemoryNote, photoCount = 1 }) {
  const g = goals, t = todayTotals;
  const mealsText = (todayLogs && todayLogs.length)
    ? todayLogs.map((l) => `- ${l.food_name || "meal"} (${l.estimated_portion || "portion unspecified"}): ${Math.round(num(l.calories))} kcal, ${Math.round(num(l.protein_g))}g protein, ${Math.round(num(l.carbs_g))}g carbs, ${Math.round(num(l.fat_g))}g fat`).join("\n")
    : "No meals logged yet today.";
  const dietaryProfileLine = (g.dietType || g.cuisine)
    ? `\nUser's dietary profile: ${g.dietType || "not specified"}${g.cuisine ? `, typically eats ${g.cuisine} food` : ""}. Use this to narrow down ambiguous or unclear items (e.g. don't guess a meat-based dish for a vegetarian user's plate) and to recognize regional dishes correctly — but still trust what's actually visible/described over the profile if they conflict.`
    : "";
  return `You are the nutrition estimation and portion-coaching engine inside a meal-logging app. Estimate the nutritional content of the meal ${mode === "photo" ? "shown in the photo" : "described by the user"}, then advise on portion size.

User's daily goals: ${g.calories} kcal, ${g.protein}g protein, ${g.carbs}g carbs, ${g.fat}g fat.${dietaryProfileLine}
Already logged today before this meal (totals): ${t.calories} kcal, ${t.protein}g protein, ${t.carbs}g carbs, ${t.fat}g fat.
Individual meals logged today so far:
${mealsText}
${mode === "text" ? `Meal description: "${description}"` : ""}${portionMemoryNote || ""}

IMPORTANT — decompose before totaling: first identify every visually or verbally distinct food item in this meal (e.g. "roti", "dal", "mixed vegetable sabzi" are three separate items even if served on one plate — do not lump them into one blended guess). Estimate each item's own portion and nutrition independently, the way you would if it were logged on its own, THEN sum those per-item numbers to produce the meal-level totals below. This item-by-item approach is consistently more accurate than a single whole-plate guess, so do not skip it even for a simple-looking meal — a single food is just a one-item breakdown.
${mode === "photo" ? (photoCount >= 2 ? `\nTwo photos of this meal were provided (different angles). Cross-reference them to judge portion depth/height with real confidence — use whichever shows height best (e.g. a side/angled shot) to correct what a top-down shot alone can't show (a thin layer vs. a mounded portion can look identical from directly above). Reflect that added confidence in "confidence" and "estimate_basis".` : `\nSingle-photo depth caveat: you're working from one photo at one angle, which can hide height/mounding (a thin layer of rice and a mounded portion can look identical from directly above). A second angle is optional and was not provided here, so do not ask for one — instead, actively reason about depth cues that ARE available in a single image: shadows at the food's edges, how much the food rises above the rim of its bowl/plate, whether the container looks fuller than a flat layer would allow, and typical serving conventions for that dish (e.g. rice and dal are rarely served perfectly flat). If the angle genuinely doesn't let you judge height with any confidence, say so plainly in "estimate_basis" and reflect that uncertainty in "confidence" rather than silently guessing flat.`) : ""}

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "reasoning": string,
  "items": [
    {"food_name": string, "estimated_portion": string, "calories": number, "protein_g": number, "carbs_g": number, "fat_g": number}
  ],
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
  "estimate_basis": string,
  "portion_verdict": "decrease" | "keep" | "increase",
  "portion_change_percent": number,
  "portion_guidance": string
}
"reasoning" MUST be written first, before you commit to any numbers, and the numbers that follow must be consistent with it. Use it to actually work through portion size like a person eyeballing the plate would — e.g. "the bowl looks about 12cm across and the rice fills roughly 60% of it at a modest mound, so that's closer to 150g than 100g or 200g" — reasoning in relative, comparative terms (fraction of plate/bowl covered, height relative to the rim, size vs. common reference objects) before turning that into a gram/count estimate. This field is for your own reasoning, not shown verbatim to the user, so think it through properly rather than writing a token justification.
"items" must list each distinct food item separately (one entry even for a single-food meal) with its own calories/macros. The top-level "food_name"/"estimated_portion" should be a short combined label for the whole meal (e.g. "Roti, dal, and mixed veg"), and the top-level calories/protein_g/carbs_g/fat_g MUST equal the sum of the corresponding values across all "items" — do not report a top-level total that doesn't match summing the items. Give 3 to 6 notable micronutrients. Weigh both the remaining daily targets AND the composition of meals already logged today (e.g. flag it if today's meals are already carb-heavy or protein-light) when deciding portion_verdict. portion_change_percent is your best-guess recommended change to THIS portion, as a signed integer percent (e.g. -25 to shrink by a quarter, 0 to keep as-is, 15 to grow it) — it must be consistent with portion_verdict. Keep portion_guidance to one or two direct sentences, plain and specific, referencing what's driving the recommendation. "estimate_basis" is one short plain sentence explaining what the confidence level is actually based on (e.g. visual portion size guesswork, ambiguous preparation method/oil content, a precisely-specified weight in the description) — this is shown to the user under "Why this estimate?" so it must be concrete and specific to this meal, not generic.`;
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

// ---------- AI Daily Coach ----------
function buildDailyCoachPrompt({ todayTotals, todayLogs, exerciseLogs, goals }) {
  const mealsText = todayLogs.length
    ? todayLogs.map((l) => `- ${l.food_name} (${Math.round(l.calories)} kcal, P${Math.round(l.protein_g)} C${Math.round(l.carbs_g)} F${Math.round(l.fat_g)}, fiber ${Math.round(l.fiber_g)}g)`).join("\n")
    : "No meals logged today.";
  const workoutsText = exerciseLogs.length
    ? exerciseLogs.map((e) => e.type === "strength" ? `- ${e.name}: ${e.sets.length} sets` : `- ${e.name}: ${e.duration_min}min cardio`).join("\n")
    : "No workouts logged today.";
  return `You are a supportive, practical daily nutrition and fitness coach embedded in a tracking app. Review this person's full day and give a short end-of-day recap.

Today's goals: ${goals.calories} kcal, ${goals.protein}g protein, ${goals.carbs}g carbs, ${goals.fat}g fat, ${goals.fiber || 28}g fiber.
Today's totals: ${Math.round(todayTotals.calories)} kcal, ${Math.round(todayTotals.protein)}g protein, ${Math.round(todayTotals.carbs)}g carbs, ${Math.round(todayTotals.fat)}g fat, ${Math.round(todayTotals.fiber || 0)}g fiber.

Meals logged today:
${mealsText}

Workouts logged today:
${workoutsText}

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "summary": string,
  "suggestions": [string, string, string]
}
"summary" is one or two sentences recapping how the day went against goals (e.g. percentages reached, what stood out) — plain, encouraging, not clinical. "suggestions" is an array of exactly 2-3 short, concrete, actionable tips for tomorrow (each under ~20 words). Base everything only on the data given; don't invent details.`;
}

// ---------- Weekly / Monthly AI Review ----------
// Pulls together a period-vs-previous-period comparison (calories/macros), plus
// gym consistency, water, and weight trend, into one stats object that gets
// handed to Gemini to narrate. Shared by both the 7-day and 30-day reviews.
function computePeriodReviewStats(logs, exerciseLogs, waterLogs, weights, goals, periodDays) {
  const thisStart = daysAgo(periodDays - 1), prevStart = daysAgo(periodDays * 2 - 1), prevEnd = daysAgo(periodDays);
  const thisLogs = logs.filter((l) => l.date >= thisStart);
  const prevLogs = logs.filter((l) => l.date >= prevStart && l.date <= prevEnd);
  const avgOf = (arr, key) => arr.length ? arr.reduce((s, l) => s + num(l[key]), 0) / periodDays : 0;
  const pctChange = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;

  const avgCalories = avgOf(thisLogs, "calories"), prevAvgCalories = avgOf(prevLogs, "calories");
  const avgProtein = avgOf(thisLogs, "protein_g"), prevAvgProtein = avgOf(prevLogs, "protein_g");
  const avgCarbs = avgOf(thisLogs, "carbs_g");
  const avgFat = avgOf(thisLogs, "fat_g");

  // Day-to-day consistency: how much daily calorie totals swing, as a % of the
  // period average — lower is steadier. Days with nothing logged are excluded
  // rather than counted as 0, which would otherwise always read as "inconsistent".
  const dayTotals = []; for (let i = periodDays - 1; i >= 0; i--) {
    const d = daysAgo(i);
    const dayLogs = logs.filter((l) => l.date === d);
    if (dayLogs.length) dayTotals.push(dayLogs.reduce((s, l) => s + num(l.calories), 0));
  }
  let consistencyPct = null;
  if (dayTotals.length >= 3) {
    const mean = dayTotals.reduce((a, b) => a + b, 0) / dayTotals.length;
    const variance = dayTotals.reduce((s, v) => s + (v - mean) ** 2, 0) / dayTotals.length;
    const stdDev = Math.sqrt(variance);
    consistencyPct = mean > 0 ? Math.round((stdDev / mean) * 100) : null;
  }

  const gymDays = new Set(exerciseLogs.filter((e) => e.date >= thisStart).map((e) => e.date)).size;
  // Sundays are treated as a rest/holiday day for gym tracking, so they're excluded
  // from the "expected" gym days rather than counted as missed sessions.
  let expectedGymDays = 0;
  for (let i = periodDays - 1; i >= 0; i--) { if (!isSundayDate(daysAgo(i))) expectedGymDays++; }
  const avgWater = waterLogs.filter((w) => w.date >= thisStart).reduce((s, w) => s + num(w.ml), 0) / periodDays;
  const weightPace = computeWeightPace(weights.filter((w) => new Date(w.timestamp).getTime() >= Date.now() - (periodDays * 2 - 1) * 86400000));

  const daysLoggedThisPeriod = new Set(thisLogs.map((l) => l.date)).size;
  const calorieGoalDays = (() => {
    let count = 0;
    for (let i = periodDays - 1; i >= 0; i--) {
      const d = daysAgo(i);
      const cal = logs.filter((l) => l.date === d).reduce((s, l) => s + num(l.calories), 0);
      if (goals.calories > 0 && cal >= goals.calories * 0.9 && cal <= goals.calories * 1.15) count++;
    }
    return count;
  })();

  return {
    periodDays,
    avgCalories: Math.round(avgCalories), avgProtein: Math.round(avgProtein), avgCarbs: Math.round(avgCarbs), avgFat: Math.round(avgFat),
    proteinChangePct: pctChange(avgProtein, prevAvgProtein), calorieChangePct: pctChange(avgCalories, prevAvgCalories),
    consistencyPct, gymDays, expectedGymDays, avgWaterL: Math.round((avgWater / 1000) * 10) / 10,
    weightPace, daysLoggedThisPeriod, calorieGoalDays, goals,
  };
}
function computeWeeklyReviewStats(logs, exerciseLogs, waterLogs, weights, goals) {
  return computePeriodReviewStats(logs, exerciseLogs, waterLogs, weights, goals, 7);
}
function computeMonthlyReviewStats(logs, exerciseLogs, waterLogs, weights, goals) {
  return computePeriodReviewStats(logs, exerciseLogs, waterLogs, weights, goals, 30);
}

function buildPeriodReviewPrompt(stats, periodLabel, priorLabel) {
  return `You are a supportive, practical nutrition and fitness coach embedded in a tracking app. Write a short ${periodLabel} review from the numbers below — no medical advice, just plain encouraging observations.

This ${periodLabel}'s averages: ${stats.avgCalories} kcal/day, ${stats.avgProtein}g protein/day, ${stats.avgCarbs}g carbs/day, ${stats.avgFat}g fat/day.
Protein vs. ${priorLabel}: ${stats.proteinChangePct == null ? "no prior data" : `${stats.proteinChangePct > 0 ? "+" : ""}${stats.proteinChangePct}%`}.
Calories vs. ${priorLabel}: ${stats.calorieChangePct == null ? "no prior data" : `${stats.calorieChangePct > 0 ? "+" : ""}${stats.calorieChangePct}%`}.
Day-to-day calorie consistency: ${stats.consistencyPct == null ? "not enough data" : `${stats.consistencyPct}% swing from the ${periodLabel} average (lower = steadier)`}.
Gym days this ${periodLabel}: ${stats.gymDays}/${stats.expectedGymDays} (Sundays are rest days and don't count against this).
Average water: ${stats.avgWaterL}L/day (goal ${(stats.goals.water || 2000) / 1000}L).
Weight trend: ${stats.weightPace ? `${stats.weightPace.paceKgPerWeek > 0 ? "+" : ""}${stats.weightPace.paceKgPerWeek.toFixed(2)}kg/week` : "not enough weigh-ins"}.
Days with at least one meal logged: ${stats.daysLoggedThisPeriod}/${stats.periodDays}.
Days calorie goal was hit: ${stats.calorieGoalDays}/${stats.periodDays}.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "summary": string,
  "focus_next_period": string
}
"summary" is 1-2 short sentences in the style of "This ${periodLabel}: protein improved 12%, weight stable, gym consistency 5/${stats.periodDays} days" — pick the 2-3 most notable numbers from above, stated plainly. "focus_next_period" is one concrete, specific suggestion for next ${periodLabel} (e.g. "Increase protein by ~15g/day"). Base everything only on the numbers given; don't invent details.`;
}
function buildWeeklyReviewPrompt(stats) { return buildPeriodReviewPrompt(stats, "week", "last week"); }
function buildMonthlyReviewPrompt(stats) { return buildPeriodReviewPrompt(stats, "month", "last month"); }

// ---------- Personal records & progressive overload ----------
// Estimated 1-rep-max via the Epley formula — used to compare sets of different
// weight/rep combinations on a like-for-like basis.
function estimate1RM(weight, reps) { return reps > 0 ? weight * (1 + reps / 30) : 0; }

// Best set per strength exercise across all history: heaviest estimated 1RM, plus
// the raw weight/reps/date that produced it.
function computePersonalRecords(exerciseLogs) {
  const records = {};
  exerciseLogs.filter((e) => e.type === "strength").forEach((e) => {
    const key = e.name.trim().toLowerCase();
    (e.sets || []).forEach((s) => {
      const oneRm = estimate1RM(num(s.weight), num(s.reps));
      if (oneRm <= 0) return;
      if (!records[key] || oneRm > records[key].oneRm) {
        records[key] = { name: e.name, oneRm, weight: num(s.weight), reps: num(s.reps), date: e.date };
      }
    });
  });
  return records;
}

// Compares a freshly-saved strength entry's best set against the previous PR
// (computed from history that excludes this entry) — returns a delta badge
// descriptor, or null for cardio / first-time exercises.
function computeProgressiveOverload(entry, priorExerciseLogs) {
  if (entry.type !== "strength" || !entry.sets || !entry.sets.length) return null;
  const bestNow = entry.sets.reduce((best, s) => {
    const oneRm = estimate1RM(num(s.weight), num(s.reps));
    return oneRm > best.oneRm ? { oneRm, weight: num(s.weight), reps: num(s.reps) } : best;
  }, { oneRm: 0, weight: 0, reps: 0 });
  const priorRecords = computePersonalRecords(priorExerciseLogs);
  const prior = priorRecords[entry.name.trim().toLowerCase()];
  if (!prior) return { isNew: true, isPR: bestNow.oneRm > 0 };
  const isPR = bestNow.oneRm > prior.oneRm + 0.01;
  const deltaWeight = bestNow.weight - prior.weight;
  return { isNew: false, isPR, deltaWeight, priorWeight: prior.weight, priorReps: prior.reps };
}

// ---------- Smart notifications ----------
// Contextual, time-aware nudges computed purely from current state — no backend
// or push infrastructure required, just re-derived on every render.
function computeSmartNotifications({ todayTotals, todayLogs, goals, todayWater, now }) {
  const hour = now.getHours();
  const notifications = [];

  const proteinGap = goals.protein - todayTotals.protein;
  if (proteinGap > 5 && proteinGap <= 35 && hour >= 14) {
    notifications.push({ id: "protein-gap", icon: Dumbbell, color: C.purple, bg: C.purpleTint, text: `You're only ${Math.round(proteinGap)}g short of your protein goal.` });
  }

  const hasLunch = todayLogs.some((l) => { const h = new Date(l.timestamp).getHours(); return h >= 11 && h < 15; });
  if (!hasLunch && hour >= 14 && hour < 17) {
    notifications.push({ id: "no-lunch", icon: Utensils, color: C.orange, bg: C.orangeTint, text: "You haven't logged lunch yet." });
  }

  const waterGoal = goals.water || 2000;
  const expectedWaterByNow = waterGoal * clamp((hour - 7) / 14, 0, 1); // rough pace from 7am to 9pm
  if (hour >= 10 && hour <= 21 && todayWater < expectedWaterByNow - 400) {
    notifications.push({ id: "water", icon: Droplets, color: C.blue, bg: C.blueTint, text: "Time to drink water — you're behind your usual pace today." });
  }

  const expectedCaloriesByNow = goals.calories * clamp((hour - 7) / 13, 0, 1); // rough pace from 7am to 8pm
  if (hour >= 13 && todayTotals.calories < expectedCaloriesByNow - 400) {
    notifications.push({ id: "low-calories", icon: Flame, color: C.pink, bg: C.pinkTint, text: "Your calorie intake is low today." });
  }

  return notifications;
}

// ---------- Ring ----------
function Ring({ size, stroke, pct, trackColor, fillColor, children }) {
  const [animatedPct, setAnimatedPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimatedPct(pct));
    return () => cancelAnimationFrame(raf);
  }, [pct]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (clamp(animatedPct, 0, 100) / 100) * c;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke={fillColor} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset .7s cubic-bezier(.22,.9,.34,1)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>
    </div>
  );
}

// ---------- Animated number counter ----------
// Eases a number from its previous value to a new one over `duration`ms
// whenever `value` changes, instead of snapping — used for the headline stats
// (calories remaining, streak, score, macro totals) so updates feel alive.
function AnimatedNumber({ value, duration = 600, decimals = 0 }) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(null);
  useEffect(() => {
    const from = fromRef.current;
    const to = num(value);
    if (from === to) { setDisplay(to); return; }
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    function tick(now) {
      const t = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const current = from + (to - from) * eased;
      setDisplay(current);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = to;
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}</>;
}

// ---------- Micro-interaction keyframes ----------
// Injected once at the app root. Covers: celebration banner slide-in, confetti
// dots, a quick center-screen "pop" for lighter confirmations, and a brief
// highlight flash used on freshly-logged rows.
function MicroInteractionStyles() {
  return (
    <style>{`
      @keyframes celebrateSlideIn { 0% { transform: translateY(-16px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      @keyframes celebratePop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.08); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes confettiFall { 0% { transform: translateY(-6px) rotate(0deg); opacity: 1; } 100% { transform: translateY(38px) rotate(180deg); opacity: 0; } }
      @keyframes rowHighlight { 0% { background-color: var(--flash-color, rgba(238,108,55,0.18)); } 100% { background-color: transparent; } }
      @keyframes checkPop { 0% { transform: scale(0); opacity: 0; } 50% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      @keyframes cardFadeSlideUp { 0% { opacity: 0; transform: translateY(18px); } 100% { opacity: 1; transform: translateY(0); } }
      @keyframes cardScaleIn { 0% { opacity: 0; transform: scale(0.94); } 100% { opacity: 1; transform: scale(1); } }
      @keyframes dotFadeScaleIn { 0% { opacity: 0; transform: scale(0.3); } 100% { opacity: 1; transform: scale(1); } }
      @keyframes insightSlideIn { 0% { opacity: 0; transform: translateX(-16px); } 100% { opacity: 1; transform: translateX(0); } }
      .anim-card-in { animation: cardFadeSlideUp .5s cubic-bezier(.22,.9,.34,1) both; }
      .anim-card-scale-in { animation: cardScaleIn .5s cubic-bezier(.22,.9,.34,1) both; }
      .anim-dot-in { animation: dotFadeScaleIn .4s cubic-bezier(.34,1.56,.64,1) both; }
      .anim-insight-in { animation: insightSlideIn .45s cubic-bezier(.22,.9,.34,1) both; }
      @keyframes sheetBackdropFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes sheetBackdropFadeOut { from { opacity: 1; } to { opacity: 0; } }
      @keyframes sheetSlideIn { from { transform: translateY(100%); } to { transform: translateY(0); } }
      @keyframes sheetSlideOut { from { transform: translateY(0); } to { transform: translateY(100%); } }
      .anim-sheet-backdrop-in { animation: sheetBackdropFadeIn .25s ease both; }
      .anim-sheet-backdrop-out { animation: sheetBackdropFadeOut .22s ease both; }
      .anim-sheet-slide-in { animation: sheetSlideIn .34s cubic-bezier(.22,.9,.34,1) both; }
      .anim-sheet-slide-out { animation: sheetSlideOut .22s cubic-bezier(.4,0,1,1) both; }
      .anim-celebrate { animation: celebrateSlideIn .35s cubic-bezier(.22,.9,.34,1); }
      .anim-pop { animation: celebratePop .4s cubic-bezier(.22,.9,.34,1); }
      .anim-row-flash { animation: rowHighlight 1.1s ease-out; }
      @keyframes rowSlideIn { 0% { transform: translateY(-14px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
      .anim-row-slide-in { animation: rowSlideIn .38s cubic-bezier(.22,.9,.34,1); }
      .anim-check-pop { animation: checkPop .45s cubic-bezier(.22,.9,.34,1); }
      @keyframes iconLiftBounce { 0% { transform: translateY(0); } 35% { transform: translateY(-7px); } 60% { transform: translateY(1px); } 100% { transform: translateY(0); } }
      .anim-icon-lift { animation: iconLiftBounce .55s cubic-bezier(.34,1.56,.64,1) .1s both; }
      @keyframes iconDropBounce { 0% { transform: translateY(-10px); opacity: 0; } 55% { transform: translateY(2px); opacity: 1; } 80% { transform: translateY(-1px); } 100% { transform: translateY(0); } }
      .anim-icon-drop { animation: iconDropBounce .5s cubic-bezier(.34,1.56,.64,1) .05s both; }
      @keyframes prBadgePop { 0% { transform: scale(0.3); opacity: 0; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
      .anim-pr-badge { animation: prBadgePop .5s cubic-bezier(.22,.9,.34,1) .3s both; }
      .fab-pill { transition: transform .5s cubic-bezier(.34,1.56,.64,1), box-shadow .3s ease; }
      @keyframes fabBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      .fab-breathe { animation: fabBreathe 2.4s ease-in-out infinite; }
      .fab-option { transition: transform .38s cubic-bezier(.34,1.56,.64,1), opacity .28s ease; }

      /* ---- Card expand (spring) ---- */
      .meal-card-expand-wrap { overflow: hidden; transition: grid-template-rows .45s cubic-bezier(.22,1.28,.36,1); display: grid; }
      @keyframes mealDetailIn { 0% { opacity: 0; transform: scale(.96) translateY(-4px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
      .anim-meal-detail-in { animation: mealDetailIn .38s cubic-bezier(.22,1.28,.36,1) both; }
      .meal-chevron { transition: transform .35s cubic-bezier(.34,1.56,.64,1); }

      /* ---- Skeleton shimmer ---- */
      @keyframes skeletonShimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
      .skeleton-shimmer {
        background: linear-gradient(90deg, ${C.line} 25%, ${C.card} 50%, ${C.line} 75%);
        background-size: 200% 100%; animation: skeletonShimmer 1.4s ease-in-out infinite;
      }

      /* ---- Streak flame flicker ---- */
      @keyframes flameFlicker {
        0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
        20% { transform: scale(1.06) rotate(-3deg); opacity: 0.92; }
        40% { transform: scale(0.97) rotate(2deg); opacity: 1; }
        60% { transform: scale(1.08) rotate(-1deg); opacity: 0.9; }
        80% { transform: scale(1.02) rotate(2deg); opacity: 1; }
      }
      .anim-flame-flicker { animation: flameFlicker 1.8s ease-in-out infinite; transform-origin: center bottom; }

      /* ---- Chip / tag pop-in ---- */
      @keyframes chipPopIn { 0% { opacity: 0; transform: scale(.5); } 65% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }
      .anim-chip-pop { animation: chipPopIn .38s cubic-bezier(.34,1.56,.64,1) both; }

      /* ---- Empty state motion ---- */
      @keyframes emptyFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
      .anim-empty-float { animation: emptyFloat 2.6s ease-in-out infinite; }

      /* ---- Cloud sync pulse ---- */
      @keyframes cloudPulse { 0%, 100% { opacity: .55; transform: scale(1); } 50% { opacity: 1; transform: scale(1.12); } }
      .anim-cloud-pulse { animation: cloudPulse 1s ease-in-out infinite; }
      @keyframes cloudRing { 0% { transform: scale(0.6); opacity: 0.5; } 100% { transform: scale(1.9); opacity: 0; } }
      .anim-cloud-ring { animation: cloudRing 1.3s ease-out infinite; }

      /* ---- Reminder notification slide ---- */
      @keyframes notifSlideIn { 0% { opacity: 0; transform: translateY(-14px) scale(.97); } 70% { opacity: 1; } 100% { opacity: 1; transform: translateY(0) scale(1); } }
      .anim-notif-slide { animation: notifSlideIn .4s cubic-bezier(.22,1.15,.36,1) both; }
      @keyframes notifPulseDot { 0%, 100% { box-shadow: 0 0 0 0 rgba(224,87,127,0.5); } 50% { box-shadow: 0 0 0 4px rgba(224,87,127,0); } }
      .anim-notif-pulse-dot { animation: notifPulseDot 1.6s ease-in-out infinite; }

      /* ---- Calendar date flip ---- */
      @keyframes dateFlipIn { 0% { opacity: 0; transform: rotateX(70deg); } 100% { opacity: 1; transform: rotateX(0deg); } }
      .anim-date-flip { display: inline-block; animation: dateFlipIn .38s cubic-bezier(.22,.9,.34,1) both; transform-style: preserve-3d; backface-visibility: hidden; }

      /* ---- Section reveal on scroll ---- */
      @keyframes sectionRevealUp { 0% { opacity: 0; transform: translateY(22px); } 100% { opacity: 1; transform: translateY(0); } }
      .anim-section-reveal { animation: sectionRevealUp .55s cubic-bezier(.22,.9,.34,1) both; }

      /* ---- Button press ripple / scale ---- */
      button:not(:disabled) { transition: transform .12s ease; }
      button:active:not(:disabled) { transform: scale(0.94); }
      .ripple-btn { position: relative; overflow: hidden; }
      .ripple-dot { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.55); transform: scale(0); animation: rippleExpand .55s ease-out forwards; pointer-events: none; }
      @keyframes rippleExpand { to { transform: scale(2.6); opacity: 0; } }
    `}</style>
  );
}

// Small centered icon "pop" used for lighter confirmations (meal logged, weight
// updated, workout completed) — brief and unobtrusive, auto-dismisses itself.
// A small checkmark badge pops in a beat after the main icon, so the moment
// reads as a confirmed success rather than just an icon flashing on screen.
function MicroPulse({ pulse }) {
  if (!pulse) return null;
  const Icon = pulse.icon;
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ zIndex: 60 }}>
      <div className="anim-pop flex items-center justify-center" style={{ width: 64, height: 64, borderRadius: "50%", background: pulse.bg, boxShadow: "0 8px 24px rgba(20,20,20,0.18)", position: "relative" }}>
        <Icon size={28} color={pulse.color} className={pulse.kind === "workout" ? "anim-icon-lift" : pulse.kind === "weight" ? "anim-icon-drop" : ""} />
        <div className="anim-check-pop flex items-center justify-center" style={{
          position: "absolute", right: -3, bottom: -3, width: 24, height: 24, borderRadius: "50%",
          background: C.green, border: `2px solid ${C.bgBottom}`,
          animationDelay: ".18s", animationFillMode: "backwards",
        }}>
          <Check size={12} color="#fff" strokeWidth={3} />
        </div>
      </div>
    </div>
  );
}

// Bigger top-of-screen banner reserved for genuine milestones (streak up,
// protein target reached, daily goal completed) — a few confetti dots for flavor.
function CelebrationBanner({ celebrations, onDismiss }) {
  if (!celebrations.length) return null;
  return (
    <div className="absolute left-4 right-4 flex flex-col gap-2" style={{ top: 8, zIndex: 60 }}>
      {celebrations.map((c) => (
        <div key={c.id} className="anim-celebrate flex items-center gap-2.5 p-3" style={{ position: "relative", overflow: "hidden", background: c.bg, borderRadius: 16, boxShadow: "0 8px 24px rgba(20,20,20,0.16)" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              position: "absolute", top: 4, right: 14 + i * 10, width: 5, height: 5, borderRadius: "50%",
              background: [C.orange, C.green, C.tan][i % 3], animation: `confettiFall .9s ease-out ${i * 0.12}s both`,
            }} />
          ))}
          <div style={{ width: 34, height: 34, borderRadius: "50%", background: "rgba(255,255,255,0.55)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <c.icon size={16} color={c.color} />
          </div>
          <span className="ft-body flex-1" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{c.text}</span>
          <button onClick={() => onDismiss(c.id)} style={{ flexShrink: 0 }}><X size={13} color={C.inkSoft} /></button>
        </div>
      ))}
    </div>
  );
}

// Bottom-anchored toast with an Undo action, shown briefly after a delete.
// Mirrors CelebrationBanner's overlay pattern (rounded card, floating above
// the content) but anchored above the bottom nav instead of at the top.
// Kept mounted a beat past `toast` clearing so it can slide back down
// instead of just vanishing — mirrors the deleted row's own animation, so
// the whole delete/undo flow reads as one consistent motion.
function UndoToast({ toast, onUndo }) {
  const [mountedToast, setMountedToast] = useState(null);
  const [leaving, setLeaving] = useState(false);
  const leaveTimerRef = useRef(null);
  useEffect(() => {
    if (toast) {
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      setMountedToast(toast);
      setLeaving(false);
    } else {
      setLeaving(true);
      leaveTimerRef.current = setTimeout(() => setMountedToast(null), 220);
    }
    return () => clearTimeout(leaveTimerRef.current);
  }, [toast]);
  if (!mountedToast) return null;
  return (
    <div className="absolute left-4 right-4 flex items-center justify-between gap-3 px-4 py-3.5"
      style={{
        bottom: "calc(84px + env(safe-area-inset-bottom, 0px))", background: C.ink, borderRadius: 16,
        boxShadow: "0 8px 24px rgba(20,20,20,0.24)", zIndex: 60,
        transform: leaving ? "translateY(16px)" : "translateY(0)",
        opacity: leaving ? 0 : 1,
        transition: leaving ? "transform .2s ease, opacity .2s ease" : "transform .32s cubic-bezier(.34,1.4,.64,1), opacity .22s ease",
      }}>
      <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.onInk }}>{mountedToast.message}</span>
      <button onClick={onUndo} className="ft-body flex-shrink-0" style={{ fontSize: 13, fontWeight: 700, color: C.orange }}>Undo</button>
    </div>
  );
}

function Avatar({ initial, size = 46 }) {
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <div style={{ width: size, height: size, borderRadius: "50%", background: C.ink, border: `2.5px solid ${C.bgTop}`, boxShadow: "0 0 0 1.5px " + C.ink, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span className="ft-display" style={{ color: C.onInk, fontSize: size * 0.42, fontWeight: 700 }}>{initial}</span>
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
    improving: { color: C.green, bg: C.greenTint, icon: TrendingUp, label: "Improving" },
    maintaining: { color: C.tan, bg: C.tanTint, icon: Minus, label: "Maintaining" },
    declining: { color: C.pink, bg: C.pinkTint, icon: TrendingDown, label: "Declining" },
    new: { color: C.blue, bg: C.blueTint, icon: Sparkles, label: "New" },
  };
  const m = map[trend] || map.new;
  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: m.bg, borderRadius: 999 }}>
      <m.icon size={11} color={m.color} />
      <span className="ft-body" style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}</span>
    </div>
  );
}

// Confidence pill for AI meal estimates — high/medium/low, color-coded so the
// user can tell at a glance how much to trust the numbers before saving.
function ConfidenceBadge({ level }) {
  if (!level || level === "manual") return null;
  const map = {
    high: { color: C.green, bg: C.greenTint, label: "High confidence" },
    medium: { color: C.tan, bg: C.tanTint, label: "Medium confidence" },
    low: { color: C.pink, bg: C.pinkTint, label: "Low confidence" },
  };
  const m = map[level] || map.medium;
  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: m.bg, borderRadius: 999 }}>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: m.color }} />
      <span className="ft-body" style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}</span>
    </div>
  );
}

function PortionBadge({ verdict, percent }) {
  if (!verdict) return null;
  const map = {
    decrease: { color: C.pink, bg: C.pinkTint, icon: TrendingDown, label: "Shrink portion" },
    increase: { color: C.green, bg: C.greenTint, icon: TrendingUp, label: "Grow portion" },
    keep: { color: C.tan, bg: C.tanTint, icon: Minus, label: "Keep as-is" },
  };
  const m = map[verdict] || map.keep;
  const pct = num(percent);
  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ background: m.bg, borderRadius: 999 }}>
      <m.icon size={11} color={m.color} />
      <span className="ft-body" style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.label}{pct !== 0 ? ` · ${pct > 0 ? "+" : ""}${pct}%` : ""}</span>
    </div>
  );
}

// Custom Recharts <Line> dot renderer: every point stays a small plain dot
// except the most recent one, which pops to a larger radius — but only once
// the chart's one-time entrance animation has finished (`expand`), so the
// line finishes drawing before the "selected" point calls attention to itself.
function makeExpandingLastDot(dataLength, expand, color) {
  return function ExpandingLastDot(props) {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return null;
    const isLast = index === dataLength - 1;
    return (
      <circle
        key={`dot-${index}`}
        cx={cx} cy={cy}
        r={isLast && expand ? 6 : 3}
        fill={color}
        style={isLast ? { transition: "r .45s cubic-bezier(.34,1.56,.64,1)" } : undefined}
      />
    );
  };
}

// Animates a number counting up from 0 to `value` over `duration` ms, but
// only while `active` is true (used for the brief "numbers landing" moment
// right after an AI meal analysis completes). When inactive it just renders
// `value` directly with no animation, so it's safe to reuse anywhere.
function CountUp({ value, active, duration = 700, decimals = 0 }) {
  const [display, setDisplay] = useState(active ? 0 : value);
  useEffect(() => {
    if (!active) { setDisplay(value); return; }
    let raf; const start = performance.now();
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, value, duration]);
  return <>{decimals > 0 ? display.toFixed(decimals) : Math.round(display)}</>;
}

const MEAL_ANALYZE_STAGES = [
  { title: "Identifying foods", subtitle: "Looking at what's on the plate" },
  { title: "Estimating portions", subtitle: "Judging size and depth" },
  { title: "Calculating nutrition", subtitle: "Crunching calories and macros" },
  { title: "Checking your goals", subtitle: "Comparing with today's intake" },
];

// Signature "AI is thinking" moment for meal analysis — replaces a plain
// spinner with the food photo itself (swept by an animated scan line) plus
// a step checklist that fills in as it goes, so the wait reads as active
// work rather than a stalled loader. Purely time-based staging, not tied to
// real Gemini progress (the API call doesn't report intermediate steps) —
// it advances every ~1.3s and holds on the last step until the real result
// (or an error) arrives and this component unmounts.
function MealAnalyzingCard({ imagePreview }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    setStage(0);
    const id = setInterval(() => setStage((s) => Math.min(s + 1, MEAL_ANALYZE_STAGES.length - 1)), 1300);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="mt-3 p-4 anim-meal-scale-in" style={{ background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
      <style>{`
        @keyframes mealScaleIn { 0% { opacity: 0; transform: scale(0.93); } 100% { opacity: 1; transform: scale(1); } }
        .anim-meal-scale-in { animation: mealScaleIn 0.35s ease both; }
        @keyframes mealScanLine { 0% { top: 6%; opacity: 0; } 12% { opacity: 1; } 88% { opacity: 1; } 100% { top: 92%; opacity: 0; } }
        .meal-scan-line { animation: mealScanLine 2.1s ease-in-out infinite; }
        @keyframes mealIconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .meal-icon-spin { animation: mealIconSpin 1.1s linear infinite; }
        @keyframes mealStepIn { 0% { opacity: 0; transform: translateX(-6px); } 100% { opacity: 1; transform: translateX(0); } }
        .meal-step-in { animation: mealStepIn 0.3s ease both; }
      `}</style>
      {imagePreview && (
        <div className="relative mb-4" style={{ borderRadius: 16, overflow: "hidden", height: 150 }}>
          <img src={`data:${imagePreview.mediaType};base64,${imagePreview.b64}`} alt="Analyzing meal" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", filter: "brightness(0.85)" }} />
          <div className="meal-scan-line" style={{ position: "absolute", left: 0, right: 0, height: 2, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)", boxShadow: `0 0 10px 2px ${C.orange}` }} />
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.25))" }} />
        </div>
      )}
      <div className="flex flex-col">
        {MEAL_ANALYZE_STAGES.map((st, i) => {
          const done = i < stage, active = i === stage;
          return (
            <div key={i} className="flex items-start gap-3" style={{ paddingBottom: i < MEAL_ANALYZE_STAGES.length - 1 ? 18 : 0 }}>
              <div className="flex flex-col items-center flex-shrink-0">
                <div className="flex items-center justify-center flex-shrink-0" style={{
                  width: 26, height: 26, borderRadius: "50%",
                  background: done ? C.greenTint : active ? C.orangeTint : C.track,
                  transition: "background .3s ease",
                }}>
                  {done ? <Check size={14} color={C.green} /> : active ? (
                    <div className="meal-icon-spin" style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.orange}`, borderTopColor: "transparent" }} />
                  ) : (
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.inkSoft, opacity: 0.4 }} />
                  )}
                </div>
                {i < MEAL_ANALYZE_STAGES.length - 1 && (
                  <div style={{ width: 2, flex: 1, minHeight: 18, background: done ? C.greenTint : C.track, transition: "background .3s ease" }} />
                )}
              </div>
              <div className={active || done ? "meal-step-in" : ""} style={{ paddingTop: 2, opacity: done || active ? 1 : 0.45 }}>
                <div className="ft-body" style={{ fontSize: 13.5, fontWeight: 700, color: C.ink }}>{st.title}</div>
                <div className="ft-body mt-0.5" style={{ fontSize: 11.5, color: C.inkSoft }}>{st.subtitle}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 mt-4 p-2.5" style={{ background: C.orangeTint, borderRadius: 12 }}>
        <Sparkles size={14} color={C.orange} className="meal-icon-spin" style={{ animationDuration: "2.4s" }} />
        <span className="ft-body" style={{ fontSize: 11.5, color: C.orangeDeep, fontWeight: 600 }}>AI in action — this usually takes 5–10 seconds</span>
      </div>
    </div>
  );
}

// Skeleton placeholder mirroring the NutritionLabel's shape while the AI call is
// in flight, so the layout doesn't jump once real data lands.
// A short, deterministic descriptor of the meal's macro balance — computed
// client-side from the numbers Gemini already returned (protein-to-calorie
// ratio, fiber grams), not a separate AI judgment call. Mirrors the "Meal
// Quality" line in the reference design without inventing new AI output.
function mealQualityBlurb(m) {
  const proteinCalPct = m.calories > 0 ? ((m.protein_g * 4) / m.calories) * 100 : 0;
  const goodFiber = m.fiber_g >= 5;
  if (proteinCalPct >= 25 && goodFiber) return { label: "Great balance", detail: "High in protein and good balance of carbs and fats." };
  if (proteinCalPct >= 25) return { label: "High protein", detail: "Strong protein content for this meal." };
  if (goodFiber) return { label: "Good fiber", detail: "Solid fiber content to help keep you full." };
  return { label: "Logged", detail: "Estimate saved — check the full breakdown below." };
}

// "Analysis Complete" summary — the landing view right after a fresh AI
// result, mirroring the reference design's overview screen: total calories
// + confidence, a macro row, a quality blurb, and three "contributes to
// today's goal" rings. Deliberately NOT shown for manual/barcode entries or
// when reopening an already-saved meal — only for a result that just came
// back from analyze().
function MealCompleteSummary({ pending, goals, justAnalyzed, onViewDetails }) {
  const quality = mealQualityBlurb(pending);
  const calPct = goals.calories > 0 ? clamp((pending.calories / goals.calories) * 100, 0, 100) : 0;
  const proPct = goals.protein > 0 ? clamp((pending.protein_g / goals.protein) * 100, 0, 100) : 0;
  const fiberGoalVal = goals.fiber || 28;
  const fibPct = clamp((pending.fiber_g / fiberGoalVal) * 100, 0, 100);
  return (
    <div className="anim-result-fade-in">
      <div className="flex items-center gap-1.5 mb-0.5">
        <Sparkles size={15} color={C.orange} />
        <span className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>Analysis Complete</span>
      </div>
      <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.inkSoft }}>Here's what I found</div>

      <div className="flex items-center justify-between p-3.5 mb-3" style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.line}` }}>
        <div>
          <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, fontWeight: 600 }}>Total</div>
          <div className="ft-display" style={{ fontSize: 30, fontWeight: 800, color: C.ink }}>
            <CountUp value={Math.round(pending.calories)} active={justAnalyzed} /> <span style={{ fontSize: 15, fontWeight: 600, color: C.inkSoft }}>kcal</span>
          </div>
        </div>
        {pending.confidence && <ConfidenceBadge level={pending.confidence} />}
      </div>

      <div className="flex gap-2 mb-3">
        {[["Protein", pending.protein_g, "g"], ["Carbs", pending.carbs_g, "g"], ["Fats", pending.fat_g, "g"], ["Fiber", pending.fiber_g, "g"]].map(([label, val, unit]) => (
          <div key={label} className="flex-1 flex flex-col items-center py-2 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <span className="ft-mono" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}><CountUp value={Math.round(val)} active={justAnalyzed} />{unit}</span>
            <span className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>{label}</span>
          </div>
        ))}
      </div>

      <div className="p-3 mb-3" style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.line}` }}>
        <div className="flex items-center justify-between mb-1.5">
          <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Meal Quality</span>
          <div className="flex flex-wrap gap-1.5 justify-end">
            {mealTags(pending).map((t, i) => <TagChip key={t.label} label={t.label} color={t.color} bg={t.bg} index={i} />)}
          </div>
        </div>
        <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>{quality.detail}</span>
      </div>

      <div className="mb-1">
        <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>This meal contributes</span>
      </div>
      <div className="flex gap-2 mb-4">
        {[
          { label: "Calories", pct: calPct, sub: `/ ${Math.round(goals.calories)} kcal`, color: C.orange, bg: C.orangeTint },
          { label: "Protein", pct: proPct, sub: `/ ${Math.round(goals.protein)}g`, color: C.green, bg: C.greenTint },
          { label: "Fiber", pct: fibPct, sub: `/ ${Math.round(fiberGoalVal)}g`, color: C.tan, bg: C.tanTint },
        ].map((r) => (
          <div key={r.label} className="flex-1 flex flex-col items-center py-2.5 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <Ring size={44} stroke={4} pct={r.pct} trackColor={r.bg} fillColor={r.color}>
              <span className="ft-mono" style={{ fontSize: 11.5, fontWeight: 700, color: C.ink }}>{Math.round(r.pct)}%</span>
            </Ring>
            <span className="ft-body mt-1.5" style={{ fontSize: 10.5, fontWeight: 600, color: C.ink }}>{r.label}</span>
            <span className="ft-body" style={{ fontSize: 9.5, color: C.inkSoft }}>{r.sub}</span>
          </div>
        ))}
      </div>

      <button onClick={onViewDetails} onPointerDown={addRippleEffect} className="ripple-btn w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body" style={{ background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600 }}>
        View Details <ChevronRight size={16} />
      </button>
    </div>
  );
}

// Portion Advice — a verdict-colored scored banner plus a short list of
// suggestions, matching the reference design's dedicated portion-advice
// screen. The "fit" score is a simple client-side computation from
// portion_change_percent (not a separate AI call) — labeled "Portion fit"
// rather than claiming AI precision it doesn't have. Suggestions are built
// entirely from data already on the meal (the AI's own portion_guidance,
// plus a protein check against today's goal) except for one static,
// always-true hydration reminder.
function PortionAdviceCard({ pending, justAnalyzed, goals }) {
  const verdict = pending.portion_verdict || "keep";
  const bannerMap = {
    keep: { title: "Good portion!", color: C.green, bg: C.greenTint },
    increase: { title: "Consider a larger portion", color: C.tan, bg: C.tanTint },
    decrease: { title: "Consider a smaller portion", color: C.pink, bg: C.pinkTint },
  };
  const banner = bannerMap[verdict] || bannerMap.keep;
  const fitScore = clamp(100 - Math.abs(num(pending.portion_change_percent)) * 2, 40, 100);
  const proteinGood = goals.protein > 0 && pending.protein_g >= goals.protein / 3;

  const suggestions = [
    pending.portion_guidance && { icon: <GuidanceIcon text={pending.portion_guidance} />, title: "Portion size", detail: pending.portion_guidance },
    proteinGood
      ? { icon: <Dumbbell size={16} color={C.green} />, title: "Protein is great", detail: "Strong protein contribution for this meal." }
      : { icon: <Dumbbell size={16} color={C.tan} />, title: "Protein", detail: "Consider adding a protein source to this meal." },
    { icon: <Droplet size={16} color={C.blue} />, title: "Hydration tip", detail: "Drink a glass of water with this meal." },
  ].filter(Boolean);

  return (
    <div className={justAnalyzed ? "anim-result-slide-up mb-3" : "mb-3"}>
      <div className="flex items-center gap-3 p-3 rounded-2xl mb-2" style={{ background: banner.bg }}>
        <Ring size={40} stroke={3.5} pct={fitScore} trackColor="rgba(255,255,255,0.5)" fillColor={banner.color}>
          <span className="ft-mono" style={{ fontSize: 11, fontWeight: 700, color: banner.color }}>{Math.round(fitScore)}</span>
        </Ring>
        <div className="flex-1">
          <span className="ft-body" style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{banner.title}</span>
          <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>Portion fit score</div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {suggestions.map((s, i) => (
          <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
            <div style={{ marginTop: 1, flexShrink: 0 }}>{s.icon}</div>
            <div className="flex-1">
              <div className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{s.title}</div>
              <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, lineHeight: 1.35 }}>{s.detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NutritionSkeleton() {
  const bar = (w, h = 12) => <SkeletonBlock width={w} height={h} radius={6} />;
  return (
    <div className="p-4 mt-3" style={{ background: C.card, border: `2px solid ${C.line}`, borderRadius: 16 }}>
      <div className="flex items-center justify-between mb-3">{bar(120, 16)}{bar(50, 22)}</div>
      <div className="flex flex-col gap-2.5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between">{bar(90 + (i % 3) * 20)}{bar(36)}</div>
        ))}
      </div>
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
      <div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Nutrition Facts</div>
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

function MacroPill({ icon: Icon, iconBg, iconColor, label, value, unit, pct }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1.5 py-3 px-2" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 3px rgba(20,20,20,0.06)" }}>
      {pct != null ? (
        <Ring size={34} stroke={3} pct={pct} trackColor={iconBg} fillColor={iconColor}>
          <Icon size={14} color={iconColor} />
        </Ring>
      ) : (
        <div style={{ width: 34, height: 34, borderRadius: "50%", background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={16} color={iconColor} />
        </div>
      )}
      <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 500 }}>{label}</span>
      <span className="ft-display" style={{ fontSize: 16, fontWeight: 700, color: C.green }}>
        {typeof value === "number" ? <AnimatedNumber value={value} decimals={Number.isInteger(value) ? 0 : 1} /> : value}{unit}
      </span>
    </div>
  );
}

// Home "Water" card — a wavy fill visual (per the reference design) sized to
// today's progress toward the water goal, with +/- controls in the header.
// Uses the same C.blue / C.card tokens as the rest of the app (light & dark).
function WaterWaveCard({ todayWater, goalMl, onAdd, onRemove, compact, animationDelay }) {
  const pct = clamp(goalMl > 0 ? (todayWater / goalMl) * 100 : 0, 0, 100);
  const fillPct = Math.max(pct, todayWater > 0 ? 6 : 0);
  const waveHeight = compact ? 90 : 130; // baseline used for the drop-fall distance; the wave area itself now stretches to fill whatever height the card actually is
  const lightOnFill = pct > (compact ? 45 : 38); // once the wave covers most of the number, switch it to a light color for contrast

  // The wave section's real rendered height can be taller than `waveHeight`
  // when this card sits in a stretched CSS-grid row (e.g. next to a taller
  // Sleep/Score tile) — grid stretch makes the outer card taller, and without
  // this the fixed-height wave block would leave a gap of bare card
  // background between the water and the rounded bottom corner. Measuring
  // the actual height keeps the falling-drop animation landing at the real
  // water surface instead of stopping short.
  const waveRef = useRef(null);
  const [measuredWaveHeight, setMeasuredWaveHeight] = useState(waveHeight);
  useEffect(() => {
    const el = waveRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect?.height;
      if (h) setMeasuredWaveHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dropFallDistance = Math.max(measuredWaveHeight, waveHeight) - 6;

  // Signature "add water" animation: every time todayWater increases (a +250ml
  // tap), spawn a droplet that falls from the top of the card into the
  // glass, plus a small ripple at the water surface timed to when it lands.
  // Both are tracked by a shared id so they can be cleaned out of state
  // together once their CSS animations finish.
  const [drops, setDrops] = useState([]);
  const prevWaterRef = useRef(todayWater);
  useEffect(() => {
    if (todayWater > prevWaterRef.current) {
      const dropId = uid();
      setDrops((d) => [...d, dropId]);
      setTimeout(() => setDrops((d) => d.filter((id) => id !== dropId)), 950);
    }
    prevWaterRef.current = todayWater;
  }, [todayWater]);

  // Goal-achieved shine/pulse: fires once at the moment todayWater first
  // reaches goalMl (not on every render while at/above goal), then clears
  // itself so the card returns to its normal resting state.
  const [justAchieved, setJustAchieved] = useState(false);
  const wasAtGoalRef = useRef(goalMl > 0 && todayWater >= goalMl);
  useEffect(() => {
    const atGoal = goalMl > 0 && todayWater >= goalMl;
    if (atGoal && !wasAtGoalRef.current) {
      setJustAchieved(true);
      const t = setTimeout(() => setJustAchieved(false), 1300);
      wasAtGoalRef.current = true;
      return () => clearTimeout(t);
    }
    if (!atGoal) wasAtGoalRef.current = false;
  }, [todayWater, goalMl]);

  return (
    <div className={`${compact ? "" : "mb-4"}${animationDelay ? " anim-card-in" : ""}`} style={{ background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", overflow: "hidden", height: compact ? "100%" : undefined, display: compact ? "flex" : undefined, flexDirection: compact ? "column" : undefined, animationDelay }}>
      <style>{`
        @keyframes waterWaveScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .water-wave-back { animation: waterWaveScroll 9s linear infinite; }
        .water-wave-front { animation: waterWaveScroll 6s linear infinite reverse; }
        @keyframes waterDropFall {
          0% { transform: translateY(-16px) scale(0.5); opacity: 0; }
          18% { opacity: 1; transform: translateY(0px) scale(1); }
          78% { opacity: 1; }
          100% { transform: translateY(${dropFallDistance}px) scale(0.5); opacity: 0; }
        }
        .water-drop-fall { animation: waterDropFall 0.6s cubic-bezier(.55,0,.85,.35) forwards; }
        @keyframes waterRippleSurface {
          0% { transform: scaleX(0.3); opacity: 0; }
          35% { opacity: 0.85; }
          100% { transform: scaleX(2.4); opacity: 0; }
        }
        .water-ripple { border-radius: 50%; border: 2px solid rgba(255,255,255,0.75); animation: waterRippleSurface 0.55s ease-out forwards; animation-delay: 0.38s; }
        @keyframes waterGoalPulse {
          0% { box-shadow: inset 0 0 0 0 rgba(255,255,255,0); }
          30% { box-shadow: inset 0 0 26px 8px rgba(255,255,255,0.5); }
          100% { box-shadow: inset 0 0 0 0 rgba(255,255,255,0); }
        }
        .water-goal-pulse { animation: waterGoalPulse 1.1s ease; }
        @keyframes waterGoalShine {
          0% { opacity: 0; left: -60%; }
          45% { opacity: 0.6; }
          100% { opacity: 0; left: 60%; }
        }
        .water-goal-shine-overlay { animation: waterGoalShine 1.3s ease; }
      `}</style>
      <div className={compact ? "flex items-center justify-between p-4 pb-2" : "flex items-center justify-between p-4 pb-3"} style={compact ? { flexShrink: 0 } : undefined}>
        <div className="flex items-center gap-2">
          <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Droplets size={15} color={C.blue} />
          </div>
          <span className="ft-display" style={{ fontSize: compact ? 15 : 18, fontWeight: 700, color: C.ink }}>Water</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={onRemove} disabled={todayWater === 0} className="flex items-center justify-center" style={{ width: compact ? 22 : 30, height: compact ? 22 : 30, borderRadius: "50%", background: C.bgBottom, opacity: todayWater === 0 ? 0.4 : 1, border: "none", flexShrink: 0 }}><Minus size={compact ? 10 : 14} color={C.inkSoft} /></button>
          <button onClick={onAdd} className="flex items-center justify-center" style={{ width: compact ? 22 : 30, height: compact ? 22 : 30, borderRadius: "50%", background: C.blueTint, border: "none", flexShrink: 0 }}><Plus size={compact ? 10 : 14} color={C.blue} /></button>
        </div>
      </div>
      <div ref={waveRef} className={justAchieved ? "water-goal-pulse" : ""} style={compact
        ? { position: "relative", flex: 1, minHeight: waveHeight, overflow: "hidden" }
        : { position: "relative", height: waveHeight, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${fillPct}%`, background: C.blue, transition: "height .6s ease" }}>
          {/* Landing ripple(s) — one per drop, anchored to the water surface
              (the top edge of this fill div), so it tracks the rising level
              automatically without any extra position math. */}
          {drops.map((id) => (
            <div key={id} className="water-ripple" style={{ position: "absolute", top: -7, left: "50%", width: compact ? 22 : 28, height: compact ? 10 : 13, marginLeft: compact ? -11 : -14, zIndex: 3, pointerEvents: "none" }} />
          ))}
        </div>
        {/* Wavy top surface — rides exactly at the fill boundary (bottom:
            fillPct%, so it tracks the rising level automatically) and
            scrolls sideways continuously for a "living water" feel. A solid
            base wave (matching the fill color exactly, so its crests blend
            seamlessly into the flat rectangle below) plus a faint lighter
            wave on top for depth. Purely horizontal-scrolling — no rotation
            anywhere — so this can't sweep into the diagonal glare artifact
            the tilt-based version had. */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: `${fillPct}%`, height: 0, transition: "bottom .6s ease", pointerEvents: "none" }}>
          <svg className="water-wave-back" viewBox="0 0 400 20" preserveAspectRatio="none" style={{ position: "absolute", left: "-50%", bottom: -7, width: "300%", height: 16, display: "block" }}>
            <path d="M0 11 Q 50 3 100 11 T 200 11 T 300 11 T 400 11 V20 H0 Z" fill={C.blue} />
          </svg>
          <svg className="water-wave-front" viewBox="0 0 400 20" preserveAspectRatio="none" style={{ position: "absolute", left: "-50%", bottom: -9, width: "300%", height: 14, display: "block" }}>
            <path d="M0 11 Q 50 19 100 11 T 200 11 T 300 11 T 400 11 V20 H0 Z" fill="#fff" opacity="0.16" />
          </svg>
        </div>
        {/* Falling drops — one spawned per +250ml tap, dropping from the top
            of the card down into the glass/bottle. */}
        {drops.map((id) => (
          <Droplets key={id} className="water-drop-fall" size={compact ? 14 : 18} color={C.blue}
            style={{ position: "absolute", top: 0, left: "50%", marginLeft: compact ? -7 : -9, zIndex: 5, pointerEvents: "none" }} />
        ))}
        {/* Goal-achieved shine sweep — plays once, briefly, when the daily
            goal is first reached. */}
        {justAchieved && (
          <div className="water-goal-shine-overlay" style={{ position: "absolute", top: 0, bottom: 0, left: "-60%", width: "60%", background: "linear-gradient(115deg, transparent 15%, rgba(255,255,255,0.85) 50%, transparent 85%)", zIndex: 6, pointerEvents: "none" }} />
        )}
        <div className="flex flex-col items-center justify-center" style={{ position: "absolute", inset: 0 }}>
          <span className="ft-display" style={{ fontSize: compact ? 19 : 26, fontWeight: 700, color: lightOnFill ? "#fff" : C.ink, transition: "color .3s ease" }}>{Math.round(todayWater)} ml</span>
          <span className="ft-body" style={{ fontSize: compact ? 10.5 : 12, color: lightOnFill ? "rgba(255,255,255,0.85)" : C.inkSoft, transition: "color .3s ease" }}>/ {Math.round(goalMl)} ml goal</span>
        </div>
      </div>
    </div>
  );
}

// A week at a glance, colored by how close each day landed to its goals —
// meant to answer "how consistent was I" faster than reading a line chart.
// Deliberately NOT wrapped in its own bordered card (see the "fewer boxes"
// pass elsewhere in this file) — it's a lightweight section, not a feature.
function WeeklyConsistencyRow({ days, lastWeekGoodCount, title = "This week's consistency" }) {
  const STATUS_COLOR = { good: C.green, ok: C.tan, off: C.pink, none: C.pink, pending: C.track };
  const goodCount = days.filter((d) => d.status === "good").length;
  const daysWithData = days.filter((d) => d.status !== "pending").length;
  const isPerfectWeek = daysWithData === 7 && goodCount === 7;
  const improved = lastWeekGoodCount != null && goodCount > lastWeekGoodCount && daysWithData === 7;
  return (
    <div className="mb-5">
      <style>{`
        @keyframes barFillGrow { 0% { height: 0%; } 100% { height: var(--fill-pct, 0%); } }
        .anim-bar-fill { animation: barFillGrow .5s cubic-bezier(.22,.9,.34,1) both; }
        @keyframes perfectWeekPop { 0% { opacity: 0; transform: scale(0.7) translateY(4px); } 60% { opacity: 1; transform: scale(1.05) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .anim-perfect-week { animation: perfectWeekPop .5s cubic-bezier(.22,.9,.34,1) .5s both; }
        @keyframes improveSlideIn { 0% { opacity: 0; transform: translateX(-8px); } 100% { opacity: 1; transform: translateX(0); } }
        .anim-improve-in { animation: improveSlideIn .4s ease .5s both; }
      `}</style>
      <div className="flex items-center justify-between mb-2.5">
        <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.inkSoft }}>{title}</span>
        {isPerfectWeek ? (
          <span className="anim-perfect-week ft-body flex items-center gap-1 px-2 py-0.5" style={{ fontSize: 11, fontWeight: 700, color: C.green, background: C.greenTint, borderRadius: 999 }}>
            <Trophy size={11} /> Perfect week
          </span>
        ) : improved ? (
          <span className="anim-improve-in ft-body flex items-center gap-1 px-2 py-0.5" style={{ fontSize: 11, fontWeight: 700, color: C.orange, background: C.orangeTint, borderRadius: 999 }}>
            <TrendingUp size={11} /> {goodCount}/7 vs {lastWeekGoodCount}/7 last week
          </span>
        ) : null}
      </div>
      <div className="flex items-center justify-between">
        {days.map((d, i) => (
          <div key={d.date} className="flex flex-col items-center gap-1.5" style={{ flex: 1 }}>
            <span className="ft-body" style={{ fontSize: 11, fontWeight: d.isToday ? 700 : 500, color: d.isToday ? C.ink : C.inkSoft }}>{d.weekdayLetter}</span>
            {/* Each day's bar fills bottom-up on mount, staggered in
                chronological (Monday -> Sunday) order via the index delay —
                "pending" (today, not logged yet) stays an empty dashed
                track with nothing to animate. */}
            <div style={{ width: 14, height: 26, borderRadius: 7, background: C.track, border: d.status === "pending" ? `2px dashed ${C.line}` : "none", overflow: "hidden", display: "flex", alignItems: "flex-end", boxShadow: d.isToday && d.status !== "pending" ? `0 0 0 2px ${STATUS_COLOR[d.status]}55` : "none" }}>
              {d.status !== "pending" && (
                <div className="anim-bar-fill" style={{
                  width: "100%", borderRadius: 7,
                  background: STATUS_COLOR[d.status],
                  "--fill-pct": `${Math.max(d.fillPct, 14)}%`,
                  animationDelay: `${i * 90}ms`,
                }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NavBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center justify-center gap-0.5 flex-1 py-2">
      <Icon size={18} strokeWidth={active ? 2.4 : 1.8} color={active ? C.orange : C.inkSoft} />
      <span className="ft-body" style={{ fontSize: 12, color: active ? C.orange : C.inkSoft, fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}

function Chip({ active, onClick, label }) {
  return (
    <button onClick={onClick} className="px-3.5 py-1.5 rounded-full ft-body"
      style={{ background: active ? C.ink : C.card, color: active ? C.onInk : C.inkSoft, fontSize: 12.5, fontWeight: 600 }}>
      {label}
    </button>
  );
}

// A small pill used for food tags ("High protein", "Low calorie", ...) that pop
// in one-by-one via a staggered animation delay based on list index.
function TagChip({ label, color, bg, index = 0 }) {
  return (
    <span className="anim-chip-pop ft-body px-2.5 py-1 rounded-full" style={{
      fontSize: 11, fontWeight: 700, color, background: bg, animationDelay: `${index * 90}ms`, animationFillMode: "backwards",
    }}>{label}</span>
  );
}

// Derives a small set of at-a-glance quality tags from a meal's macros (purely
// computed client-side — no extra AI call) so a meal card can show a few
// pop-in chips like "High protein" / "Low calorie" / "High fiber".
function mealTags(m) {
  const tags = [];
  const proteinCalPct = m.calories > 0 ? ((num(m.protein_g) * 4) / m.calories) * 100 : 0;
  if (proteinCalPct >= 25) tags.push({ label: "High protein", color: C.green, bg: C.greenTint });
  if (num(m.calories) > 0 && num(m.calories) <= 350) tags.push({ label: "Low calorie", color: C.blue, bg: C.blueTint });
  if (num(m.fiber_g) >= 5) tags.push({ label: "High fiber", color: C.tan, bg: C.tanTint });
  if (num(m.fat_g) > 0 && num(m.fat_g) <= 10) tags.push({ label: "Low fat", color: C.purple, bg: C.purpleTint });
  if (tags.length === 0) tags.push({ label: "Logged", color: C.inkSoft, bg: C.track });
  return tags;
}

// Lightweight scroll-reveal wrapper: fades + lifts its children up once they
// first enter the viewport, then leaves them alone (no re-triggering on
// scroll-back so long lists don't keep re-animating).
function RevealOnScroll({ children, className = "", style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { setVisible(true); io.disconnect(); } });
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={(visible ? "anim-section-reveal " : "") + className} style={{ ...style, opacity: visible ? undefined : 0 }}>
      {children}
    </div>
  );
}

// Attaches a quick expanding-circle ripple at the tap point to any button —
// used for primary/FAB-style buttons where a plain scale-down feels flat.
function addRippleEffect(e) {
  const btn = e.currentTarget;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const x = (e.clientX ?? rect.left + rect.width / 2) - rect.left - size / 2;
  const y = (e.clientY ?? rect.top + rect.height / 2) - rect.top - size / 2;
  const dot = document.createElement("span");
  dot.className = "ripple-dot";
  dot.style.width = dot.style.height = `${size}px`;
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  btn.appendChild(dot);
  setTimeout(() => dot.remove(), 560);
}

// Uniform shimmering placeholder block for anywhere content ("AI is thinking",
// data still loading) would otherwise show a static gray blank.
function SkeletonBlock({ width = "100%", height = 14, radius = 8, style }) {
  return <div className="skeleton-shimmer" style={{ width, height, borderRadius: radius, ...style }} />;
}

// ---------- Swipeable / long-press row ----------
// Wraps a log row (meal or exercise) so it can be swiped left to reveal quick
// actions (Edit / Duplicate / Delete), or long-pressed for the same menu — a
// lighter-weight alternative to always-visible icon buttons on touch devices.
// Tapping the row content (or anywhere else) while open closes it again.
function SwipeRow({ children, onEdit, onDuplicate, onDelete, actionWidth = 132 }) {
  const [dragX, setDragX] = useState(0);
  const [open, setOpen] = useState(false);
  // "removing" plays a shrink+slide-out before the item is actually dropped
  // from the underlying list — otherwise the row would just vanish and the
  // rows below it would snap upward instantly. The outer grid-rows collapse
  // (1fr -> 0fr) animates the height closed without needing to know the
  // row's actual pixel height in advance (works the same for meal rows,
  // exercise rows, compact or not).
  const [removing, setRemoving] = useState(false);
  const dragStartX = useRef(null);
  const draggingRef = useRef(false);
  const longPressTimer = useRef(null);

  function openActions() { setDragX(-actionWidth); setOpen(true); }
  function closeActions() { setDragX(0); setOpen(false); }
  function triggerDelete() {
    closeActions();
    setRemoving(true);
    setTimeout(() => { onDelete && onDelete(); }, 260);
  }

  function onTouchStart(e) {
    dragStartX.current = e.touches[0].clientX;
    draggingRef.current = false;
    longPressTimer.current = setTimeout(() => {
      if (!draggingRef.current) { haptic("light"); openActions(); }
    }, 500);
  }
  function onTouchMove(e) {
    if (dragStartX.current == null) return;
    const dx = e.touches[0].clientX - dragStartX.current;
    if (Math.abs(dx) > 6) { draggingRef.current = true; clearTimeout(longPressTimer.current); }
    const base = open ? -actionWidth : 0;
    setDragX(clamp(base + dx, -actionWidth, 0));
  }
  function onTouchEnd() {
    clearTimeout(longPressTimer.current);
    dragStartX.current = null;
    if (dragX < -actionWidth / 2) { openActions(); if (!open) haptic("light"); }
    else closeActions();
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: removing ? "0fr" : "1fr", transition: "grid-template-rows .26s cubic-bezier(.4,0,.6,1)" }}>
      <div style={{ overflow: "hidden", minHeight: 0 }}>
        <div className="relative" style={{
          overflow: "hidden", borderRadius: 16,
          opacity: removing ? 0 : 1,
          transform: removing ? "translateX(-70px) scale(0.92)" : "translateX(0) scale(1)",
          transition: "opacity .22s ease, transform .26s cubic-bezier(.4,0,.6,1)",
        }}>
          <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: actionWidth }}>
            {onEdit && (
              <button onClick={() => { closeActions(); onEdit(); }} className="flex-1 flex items-center justify-center" style={{ background: C.blue }}><Pencil size={15} color="#fff" /></button>
            )}
            {onDuplicate && (
              <button onClick={() => { closeActions(); onDuplicate(); }} className="flex-1 flex items-center justify-center" style={{ background: C.tan }}><Copy size={15} color="#fff" /></button>
            )}
            {onDelete && (
              <button onClick={triggerDelete} className="flex-1 flex items-center justify-center" style={{ background: C.pink }}><Trash2 size={15} color="#fff" /></button>
            )}
          </div>
          <div
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            onClick={() => { if (open) closeActions(); }}
            style={{ transform: `translateX(${dragX}px)`, transition: dragStartX.current == null ? "transform .25s cubic-bezier(.22,.9,.34,1)" : "none", touchAction: "pan-y" }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text, compact, icon: Icon = Utensils }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: compact ? "20px 0" : "40px 0" }}>
      <div className="anim-empty-float" style={{
        width: compact ? 48 : 64, height: compact ? 48 : 64, borderRadius: "50%",
        background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12,
      }}>
        <Icon size={compact ? 20 : 26} color={C.orange} strokeWidth={1.6} />
      </div>
      <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft, maxWidth: 220, lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

// ---------- Virtualized list ----------
// Lightweight windowed-rendering container (no external dependency) so a meal
// history with hundreds of entries stays smooth: only the rows near the visible
// scroll position are actually mounted. Falls back to the normal flow layout for
// short lists (see the VIRTUALIZE_THRESHOLD check at each call site).
function VirtualList({ items, itemHeight, gap = 10, height, renderItem, overscan = 6 }) {
  const [scrollTop, setScrollTop] = useState(0);
  const rowHeight = itemHeight + gap;
  const totalHeight = items.length * rowHeight - gap;
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(items.length, startIndex + visibleCount);
  const visible = items.slice(startIndex, endIndex);
  return (
    <div onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)} style={{ height, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
      <div style={{ height: Math.max(totalHeight, 0), position: "relative" }}>
        {visible.map((item, i) => {
          const index = startIndex + i;
          return (
            <div key={item.id ?? index} style={{ position: "absolute", top: index * rowHeight, left: 0, right: 0, height: itemHeight }}>
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
const VIRTUALIZE_THRESHOLD = 30;

// ---------- Mini calendar (logged-days view) ----------
// Compact month grid with colored dots marking days that have meal and/or
// exercise entries. Tapping a day filters the Logs list to that date.
function MiniCalendar({ mealDates, exerciseDates, selectedDate, onSelectDate }) {
  const [monthCursor, setMonthCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const year = monthCursor.getFullYear(), month = monthCursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  const cellDate = (d) => `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isToday = (d) => cellDate(d) === todayStr();
  const monthLabel = monthCursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={15} color={C.ink} />
          <span key={monthLabel} className="ft-body anim-date-flip" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{monthLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonthCursor((m) => { const n = new Date(m); n.setMonth(n.getMonth() - 1); return n; })} className="p-1.5"><ChevronLeft size={16} color={C.inkSoft} /></button>
          <button onClick={() => setMonthCursor((m) => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n; })} className="p-1.5"><ChevronRight size={16} color={C.inkSoft} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="ft-body text-center" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d == null) return <div key={i} />;
          const date = cellDate(d);
          const hasMeal = mealDates.has(date), hasEx = exerciseDates.has(date);
          const selected = selectedDate === date;
          return (
            <button key={i} onClick={() => onSelectDate(selected ? null : date)}
              className="flex flex-col items-center justify-center"
              style={{ aspectRatio: "1", borderRadius: 12, background: selected ? C.ink : "transparent" }}>
              <span className="ft-mono" style={{ fontSize: 12, color: selected ? C.onInk : isToday(d) ? C.orange : C.ink, fontWeight: isToday(d) ? 700 : 500 }}>{d}</span>
              <div className="flex gap-0.5 mt-0.5" style={{ height: 4 }}>
                {hasMeal && <div style={{ width: 4, height: 4, borderRadius: 2, background: selected ? C.onInk : C.orange }} />}
                {hasEx && <div style={{ width: 4, height: 4, borderRadius: 2, background: selected ? C.onInk : C.blue }} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function MealTracker() { 
  const [darkMode, setDarkMode] = useState(localStorage.getItem("theme") === "dark");
    const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);

      if (currentUser) {
        try {
          const result = await migrateLocalDataToCloud(currentUser);
          console.log("Nourish cloud migration:", result);
          if (result.reason === "cloud-exists" && result.cloudData) {
            await hydrateLocalFromCloud(result.cloudData);
            await loadAll();
          }
        } catch (error) {
          console.error("Nourish cloud migration failed:", error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Retry any cloud syncs that failed while offline: once on sign-in/reload
  // (in case the app launched with pending items already queued), and again
  // every time the device regains connectivity.
  useEffect(() => {
    if (!user) return;
    flushSyncQueue(user);
    const onOnline = () => flushSyncQueue(user);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [user]);

const handleGoogleSignIn = async () => {
  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      const result = await FirebaseAuthentication.signInWithGoogle({
        useCredentialManager: false,
      });

      // The native call above signs in on the Android/iOS side only. The JS
      // Firebase Auth instance (which onAuthStateChanged below is watching)
      // is a SEPARATE auth state and won't update on its own unless we
      // explicitly hand it the same credential here.
      const idToken = result?.credential?.idToken;
      if (!idToken) {
        throw new Error(
          "Native Google sign-in returned no idToken — check that the Web client ID configured for the app matches the one in Firebase/Google Cloud."
        );
      }
      const accessToken = result?.credential?.accessToken;
      const credential = GoogleAuthProvider.credential(idToken, accessToken);
      await signInWithCredential(auth, credential);
      return;
    }

    await signInWithPopup(auth, googleProvider);
  } catch (error) {
    console.error("Google Sign-In Error:", error);
    alert(
      `Google Sign-In failed:\n${error?.code || "unknown"}\n${
        error?.message || "Unknown error"
      }`
    );
  }
};
  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Sign-Out Error:", error);
    }
  };
  C = darkMode ? DARK : LIGHT;
  useEffect(() => {
    localStorage.setItem("theme", darkMode ? "dark" : "light");
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    document.body.style.background = darkMode ? DARK.bgBottom : LIGHT.bgBottom;
  }, [darkMode]);
  const [tab, setTab] = useState("home");
  const [ready, setReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addLogType, setAddLogType] = useState("meal");
  const [fabPressed, setFabPressed] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [addMode, setAddMode] = useState("photo");
  const [logsSubTab, setLogsSubTab] = useState("meals");
  const [expandedMealId, setExpandedMealId] = useState(null);
  const [logsDateFilter, setLogsDateFilter] = useState(null);
  const [chartsSubTab, setChartsSubTab] = useState("nutrition");
  const [nutritionChartMetric, setNutritionChartMetric] = useState("calories");
  const [chartsPeriod, setChartsPeriod] = useState("week");
  // Charts should draw in once when the Insights tab (or a sub-tab within it)
  // is freshly opened, then hold still — switching the macro metric or any
  // other unrelated re-render must NOT replay the animation.
  const [chartsSettled, setChartsSettled] = useState(false);
  useEffect(() => {
    if (tab !== "charts") return;
    setChartsSettled(false);
    const t = setTimeout(() => setChartsSettled(true), 700);
    return () => clearTimeout(t);
  }, [tab, chartsSubTab]);

  const [profile, setProfile] = useState({ name: "" });
  const [goals, setGoals] = useState({ calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, sleep: 480, targetWeight: 0, dietType: "", cuisine: "" });
  const [logs, setLogs] = useState([]);
  const logsRef = useRef(logs);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  const [weights, setWeights] = useState([]);
  const [exerciseLogs, setExerciseLogs] = useState([]);
  const exerciseLogsRef = useRef(exerciseLogs);
  useEffect(() => { exerciseLogsRef.current = exerciseLogs; }, [exerciseLogs]);
  const [favorites, setFavorites] = useState([]);
  const [waterLogs, setWaterLogs] = useState([]);
  const [sleepLogs, setSleepLogs] = useState([]);
  const [showSleep, setShowSleep] = useState(false);
  const [showWeight, setShowWeight] = useState(false);
  const [showScore, setShowScore] = useState(false);
  const [weightAddOpen, setWeightAddOpen] = useState(false);
  const [weightInputHome, setWeightInputHome] = useState("");
  const [splits, setSplits] = useState([]);
  const [dailyCoach, setDailyCoach] = useState(null); // { date, summary, suggestions }
  const [weeklyReview, setWeeklyReview] = useState(null); // { weekStart, summary, focusNextWeek, generatedAt }
  const [monthlyReview, setMonthlyReview] = useState(null); // { monthStart, summary, focusNextMonth, generatedAt }
  const [editingEntry, setEditingEntry] = useState(null);

  const loadAll = useCallback(async () => {
    const [p, g, l, w, e, f, wa, sl, sp, dc, wr, mr] = await Promise.all([
      loadKey("profile", { name: "" }),
      loadKey("goals", { calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, sleep: 480, targetWeight: 0 }),
      loadKey("meal-logs", []),
      loadKey("weight-logs", []),
      loadKey("exercise-logs", []),
      loadKey("favorite-meals", []),
      loadKey("water-logs", []),
      loadKey("sleep-logs", []),
      loadKey("workout-splits", DEFAULT_SPLITS),
      loadKey("daily-coach", null),
      loadKey("weekly-review", null),
      loadKey("monthly-review", null),
    ]);
    setProfile(p); setGoals({ calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, sleep: 480, targetWeight: 0, dietType: "", cuisine: "", ...g }); setLogs(l); setWeights(w); setExerciseLogs(e); setFavorites(f); setWaterLogs(wa); setSleepLogs(sl); setSplits(sp); setDailyCoach(dc); setWeeklyReview(wr); setMonthlyReview(mr); setReady(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);


  // ---------- Pull-to-refresh ----------
  // Touch-driven, no external library: tracks a downward drag that only starts
  // when the scroll container is already at the top, applies resistance, and
  // reloads persisted data past the threshold.
  const scrollRef = useRef(null);
  const dateJumpInputRef = useRef(null);
  const pullStartY = useRef(null);
  const swipeStart = useRef(null); // { x, y } — tracked independently of the vertical pull gesture
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Briefly true right after a successful pull-to-refresh, so a checkmark
  // can flash before the indicator collapses — a beat of confirmation
  // rather than the spinner just vanishing.
  const [refreshSuccess, setRefreshSuccess] = useState(false);

  // ---------- Undo toast ----------
  // Small safety net for deletes: keep the removed item around briefly so a
  // mis-tap on Trash can be reversed instead of being permanently lost.
  const [undoToast, setUndoToast] = useState(null); // { message, onUndo }
  const undoTimerRef = useRef(null);
  function showUndoToast(message, onUndo) {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast({ message, onUndo });
    undoTimerRef.current = setTimeout(() => setUndoToast(null), 4500);
  }
  function handleUndoTap() {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoToast((current) => { current?.onUndo?.(); return null; });
  }
  useEffect(() => () => { if (undoTimerRef.current) clearTimeout(undoTimerRef.current); }, []);
  const PULL_THRESHOLD = 64;
  // Which day the Home dashboard is showing: 0 = today, 1 = yesterday, etc.
  // Swiping left/right between days is Home-only and read-only for past days.
  const [dashDayOffset, setDashDayOffset] = useState(0);

  // ---------- Home day-swipe slide transition ----------
  // Purely visual choreography around the (still instant) dashDayOffset
  // swap: the current content slides out in the swipe direction, THEN the
  // data changes and the new content slides in from the opposite side —
  // rather than the content just jumping to new numbers in place. The date
  // header lives inside the same sliding block, so it moves with the
  // content. Phases: "out" (exit playing) -> "jump" (data just swapped,
  // new content instantly placed off-screen, no transition) -> "in"
  // (entrance playing) -> null (settled).
  const [dayTransition, setDayTransition] = useState(null); // { dir: "left"|"right", phase: "out"|"jump"|"in" } | null
  const dayTransitionTimers = useRef([]);
  useEffect(() => () => dayTransitionTimers.current.forEach(clearTimeout), []);
  function animateDayChange(newOffset, dir) {
    if (newOffset === dashDayOffset || newOffset < 0) return;
    dayTransitionTimers.current.forEach(clearTimeout);
    dayTransitionTimers.current = [];
    setDayTransition({ dir, phase: "out" });
    dayTransitionTimers.current.push(setTimeout(() => {
      setDashDayOffset(newOffset);
      setDayTransition({ dir, phase: "jump" });
      requestAnimationFrame(() => requestAnimationFrame(() => setDayTransition({ dir, phase: "in" })));
      dayTransitionTimers.current.push(setTimeout(() => setDayTransition(null), 260));
    }, 190));
  }
  function dayTransitionStyle() {
    if (!dayTransition) return { transform: "none", opacity: 1, transition: "transform .22s cubic-bezier(.22,.9,.34,1), opacity .2s ease" };
    const sign = dayTransition.dir === "left" ? -1 : 1;
    if (dayTransition.phase === "out") return { transform: `translateX(${sign * 22}%)`, opacity: 0, transition: "transform .19s ease, opacity .19s ease" };
    if (dayTransition.phase === "jump") return { transform: `translateX(${-sign * 22}%)`, opacity: 0, transition: "none" };
    return { transform: "translateX(0)", opacity: 1, transition: "transform .22s cubic-bezier(.22,.9,.34,1), opacity .2s ease" }; // "in"
  }

  // ---------- Bottom-nav tab-slide transition ----------
  // Same "out -> swap -> in" choreography as the day-swipe above, applied to
  // switching between Home/Logs/Insights/Profile — the outgoing tab slides
  // out toward whichever side matches the nav order, then the new tab mounts
  // (React only ever has one tab's content mounted, same as before — this is
  // a slide-and-swap illusion, not two tabs rendered at once) and slides in
  // from the other side, instead of the content just cutting instantly.
  const TAB_ORDER = ["home", "logs", "charts", "profile"];
  const [tabTransition, setTabTransition] = useState(null); // { dir: "left"|"right", phase: "out"|"jump"|"in" } | null
  const tabTransitionTimers = useRef([]);
  useEffect(() => () => tabTransitionTimers.current.forEach(clearTimeout), []);
  function animateTabChange(newTab) {
    if (newTab === tab) return;
    const dir = TAB_ORDER.indexOf(newTab) > TAB_ORDER.indexOf(tab) ? "left" : "right";
    tabTransitionTimers.current.forEach(clearTimeout);
    tabTransitionTimers.current = [];
    setTabTransition({ dir, phase: "out" });
    tabTransitionTimers.current.push(setTimeout(() => {
      setTab(newTab);
      setTabTransition({ dir, phase: "jump" });
      requestAnimationFrame(() => requestAnimationFrame(() => setTabTransition({ dir, phase: "in" })));
      tabTransitionTimers.current.push(setTimeout(() => setTabTransition(null), 240));
    }, 160));
  }
  function tabTransitionStyle() {
    if (!tabTransition) return { transform: "none", opacity: 1, transition: "transform .2s cubic-bezier(.22,.9,.34,1), opacity .18s ease" };
    const sign = tabTransition.dir === "left" ? -1 : 1;
    if (tabTransition.phase === "out") return { transform: `translateX(${sign * 5}%)`, opacity: 0, transition: "transform .16s ease, opacity .16s ease" };
    if (tabTransition.phase === "jump") return { transform: `translateX(${-sign * 5}%)`, opacity: 0, transition: "none" };
    return { transform: "translateX(0)", opacity: 1, transition: "transform .2s cubic-bezier(.22,.9,.34,1), opacity .18s ease" }; // "in"
  }

  const onPullTouchStart = (e) => {
    pullStartY.current = scrollRef.current && scrollRef.current.scrollTop === 0 && !refreshing ? e.touches[0].clientY : null;
    swipeStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onPullTouchMove = (e) => {
    if (pullStartY.current == null) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    if (delta > 0) setPullDistance(Math.min(delta * 0.45, 80));
  };
  const onPullTouchEnd = async (e) => {
    if (swipeStart.current != null && tab === "home") {
      const touch = (e.changedTouches && e.changedTouches[0]) || null;
      if (touch) {
        const dx = touch.clientX - swipeStart.current.x;
        const dy = touch.clientY - swipeStart.current.y;
        if (Math.abs(dx) > 56 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          haptic("light");
          if (dx < 0) animateDayChange(dashDayOffset + 1, "left");
          else if (dashDayOffset > 0) animateDayChange(Math.max(dashDayOffset - 1, 0), "right");
        }
      }
    }
    swipeStart.current = null;
    if (pullStartY.current == null) { setPullDistance(0); return; }
    pullStartY.current = null;
    if (pullDistance > PULL_THRESHOLD) {
      setRefreshing(true);
      haptic("light");
      await loadAll();
      setRefreshing(false);
      setRefreshSuccess(true);
      haptic("success");
      setTimeout(() => { setRefreshSuccess(false); setPullDistance(0); }, 550);
      return;
    }
    setPullDistance(0);
  };

  const todayLogs = useMemo(() => logs.filter((l) => l.date === todayStr()), [logs]);
  const todayExerciseLogs = useMemo(() => exerciseLogs.filter((e) => e.date === todayStr()), [exerciseLogs]);
  const todayTotals = useMemo(() => todayLogs.reduce((acc, l) => ({
    calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g), fiber: acc.fiber + num(l.fiber_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }), [todayLogs]);

  // ---------- Home dashboard "viewed day" (swipe left/right between days) ----------
  // Read-only: swiping the Home dashboard changes which day's totals it shows,
  // without touching what "today" means anywhere else (water logging, the AI
  // daily coach, the floating + button all always act on the real today).
  const viewedDate = useMemo(() => daysAgo(dashDayOffset), [dashDayOffset]);
  const viewedIsToday = dashDayOffset === 0;
  const viewedLogs = useMemo(() => (viewedIsToday ? todayLogs : logs.filter((l) => l.date === viewedDate)), [viewedIsToday, todayLogs, logs, viewedDate]);
  const viewedExerciseLogs = useMemo(() => (viewedIsToday ? todayExerciseLogs : exerciseLogs.filter((e) => e.date === viewedDate)), [viewedIsToday, todayExerciseLogs, exerciseLogs, viewedDate]);
  const viewedTotals = useMemo(() => (viewedIsToday ? todayTotals : viewedLogs.reduce((acc, l) => ({
    calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g), fiber: acc.fiber + num(l.fiber_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 })), [viewedIsToday, todayTotals, viewedLogs]);
  const viewedWater = useMemo(() => (viewedIsToday ? null : waterLogs.filter((w) => w.date === viewedDate).reduce((s, w) => s + num(w.ml), 0)), [viewedIsToday, waterLogs, viewedDate]);

  // Most-recently-eaten distinct meals (by name), for one-tap re-log alongside favorites.
  const recentMeals = useMemo(() => {
    const seen = new Set(); const out = [];
    for (const l of logs) {
      const key = (l.food_name || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key); out.push(l);
      if (out.length >= 10) break;
    }
    return out;
  }, [logs]);

  const streak = useMemo(() => {
    const dates = new Set(logs.map((l) => l.date));
    let s = 0; let d = new Date();
    if (!dates.has(todayStr())) d.setDate(d.getDate() - 1);
    while (dates.has(localDateStr(d))) { s++; d.setDate(d.getDate() - 1); }
    return s;
  }, [logs]);

  // Longest-ever run of consecutive logging days (any date in range, not just the
  // current run) — used by the Summary view.
  const bestStreak = useMemo(() => {
    const dates = [...new Set(logs.map((l) => l.date))].sort();
    if (dates.length === 0) return 0;
    let best = 1, run = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]); const cur = new Date(dates[i]);
      const diffDays = Math.round((cur - prev) / 86400000);
      run = diffDays === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }, [logs]);

  // Cloud sync pulse — briefly flips true whenever a persist* function pushes
  // to Firestore, so the header can show a small "backing up" cloud animation
  // instead of syncing invisibly. Debounced so rapid successive saves (e.g.
  // typing in a text field) don't make the icon flicker on and off.
  const [cloudSyncing, setCloudSyncing] = useState(false);
  const cloudSyncOffTimer = useRef(null);
  function syncAndPulse(key, value) {
    if (!user) return;
    setCloudSyncing(true);
    const p = syncKeyToCloud(user, key, value);
    Promise.resolve(p).finally(() => {
      clearTimeout(cloudSyncOffTimer.current);
      cloudSyncOffTimer.current = setTimeout(() => setCloudSyncing(false), 700);
    });
    return p;
  }

  async function persistLogs(next) { setLogs(next); await saveKey("meal-logs", next); syncAndPulse("meal-logs", next); }
  async function persistWeights(next) { setWeights(next); await saveKey("weight-logs", next); syncAndPulse("weight-logs", next); }
  async function addWeightEntry(w) {
    const entry = { id: uid(), date: todayStr(), timestamp: Date.now(), weight: w };
    haptic("success");
    firePulse("weight");
    await persistWeights([entry, ...weights.filter((x) => x.date !== todayStr())]);
  }
  async function deleteWeightEntry(id) { haptic("delete"); await persistWeights(weights.filter((w) => w.id !== id)); }
  async function persistWater(next) { setWaterLogs(next); await saveKey("water-logs", next); syncAndPulse("water-logs", next); }
  async function addWater(ml) {
    haptic("light");
    await persistWater([{ id: uid(), date: todayStr(), ml, timestamp: Date.now() }, ...waterLogs]);
  }
  async function persistSleep(next) { setSleepLogs(next); await saveKey("sleep-logs", next); syncAndPulse("sleep-logs", next); }
  async function addSleep(bedtime, wakeTime) {
    const entry = { id: uid(), date: todayStr(), bedtime, wakeTime, durationMinutes: sleepDurationMinutes(bedtime, wakeTime), timestamp: Date.now() };
    haptic("success");
    firePulse("sleep");
    await persistSleep([entry, ...sleepLogs.filter((s) => s.date !== todayStr())]);
  }
  async function deleteSleep(id) { haptic("delete"); await persistSleep(sleepLogs.filter((s) => s.id !== id)); }
  async function removeLastWater() {
    const idx = waterLogs.findIndex((w) => w.date === todayStr());
    if (idx === -1) return;
    haptic("light");
    await persistWater(waterLogs.filter((_, i) => i !== idx));
  }
  async function persistGoals(next) { setGoals(next); await saveKey("goals", next); syncAndPulse("goals", next); }
  async function persistProfile(next) { setProfile(next); await saveKey("profile", next); syncAndPulse("profile", next); }
  async function persistExercise(next) { setExerciseLogs(next); await saveKey("exercise-logs", next); syncAndPulse("exercise-logs", next); }
  async function persistSplits(next) { setSplits(next); await saveKey("workout-splits", next); syncAndPulse("workout-splits", next); }
  async function persistDailyCoach(next) { setDailyCoach(next); await saveKey("daily-coach", next); syncAndPulse("daily-coach", next); }
  async function persistWeeklyReview(next) { setWeeklyReview(next); await saveKey("weekly-review", next); syncAndPulse("weekly-review", next); }
  async function persistMonthlyReview(next) { setMonthlyReview(next); await saveKey("monthly-review", next); syncAndPulse("monthly-review", next); }
  async function persistFavorites(next) { setFavorites(next); await saveKey("favorite-meals", next); syncAndPulse("favorite-meals", next); }

  async function deleteLog(id) {
    haptic("delete");
    const removed = logs.find((l) => l.id === id);
    await persistLogs(logs.filter((l) => l.id !== id));
    if (removed) {
      showUndoToast("Meal deleted", async () => {
        await persistLogs([removed, ...logsRef.current.filter((l) => l.id !== id)]);
        setJustAddedId(removed.id); setTimeout(() => setJustAddedId(null), 1200);
      });
    }
  }
  async function deleteExercise(id) {
    haptic("delete");
    const removed = exerciseLogs.find((e) => e.id === id);
    await persistExercise(exerciseLogs.filter((e) => e.id !== id));
    if (removed) {
      showUndoToast("Exercise deleted", async () => {
        await persistExercise([removed, ...exerciseLogsRef.current.filter((e) => e.id !== id)]);
        setJustAddedId(removed.id); setTimeout(() => setJustAddedId(null), 1200);
      });
    }
  }

  async function toggleFavorite(meal) {
    const key = (meal.food_name || "").trim().toLowerCase();
    if (!key) return;
    const exists = favorites.some((f) => (f.food_name || "").trim().toLowerCase() === key);
    if (exists) {
      await persistFavorites(favorites.filter((f) => (f.food_name || "").trim().toLowerCase() !== key));
    } else {
      const { food_name, estimated_portion, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, micronutrients } = meal;
      await persistFavorites([{ id: uid(), food_name, estimated_portion, calories, protein_g, carbs_g, fat_g, fiber_g, sugar_g, sodium_mg, micronutrients }, ...favorites]);
    }
  }

  function openEdit(type, entry) { setEditingEntry({ type, entry }); setAddLogType(type); setShowAdd(true); }

  async function duplicateLog(l) {
    const { id, date, timestamp, ...rest } = l;
    await persistLogs([{ id: uid(), date: todayStr(), timestamp: Date.now(), ...rest }, ...logs]);
  }
  async function duplicateExercise(e) {
    const { id, date, timestamp, ...rest } = e;
    await persistExercise([{ id: uid(), date: todayStr(), timestamp: Date.now(), ...rest }, ...exerciseLogs]);
  }

  function openAdd(logType, mode) { setEditingEntry(null); setAddLogType(logType); setAddMode(mode || "photo"); setShowAdd(true); }

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
  const weightPace = useMemo(() => computeWeightPace(weights), [weights]);
  const weightProjection = useMemo(() => weightPace ? projectWeeksToGoal(weightPace.currentWeight, goals.targetWeight, weightPace.paceKgPerWeek) : null, [weightPace, goals.targetWeight]);
  const insights = useMemo(() => generateInsights(logs, exerciseLogs, goals), [logs, exerciseLogs, goals, darkMode]);
  const weeklyDeltaStats = useMemo(() => computeWeeklyReviewStats(logs, exerciseLogs, waterLogs, weights, goals), [logs, exerciseLogs, waterLogs, weights, goals]);
  const weeklyConsistency = useMemo(() => computeWeeklyConsistency(logs, goals, 7), [logs, goals]);
  const lastWeekConsistency = useMemo(() => computeWeeklyConsistency(logs, goals, 7, 7), [logs, goals]);
  const lastWeekGoodCount = useMemo(() => lastWeekConsistency.filter((d) => d.status === "good").length, [lastWeekConsistency]);
  const periodSummary = useMemo(() => computePeriodSummary(logs, chartsPeriod === "week" ? 7 : 30), [logs, chartsPeriod]);
  const todayWater = useMemo(() => waterLogs.filter((w) => w.date === todayStr()).reduce((s, w) => s + num(w.ml), 0), [waterLogs]);
  const todaySleep = useMemo(() => sleepLogs.find((s) => s.date === todayStr()) || null, [sleepLogs]);
  const latestWeight = useMemo(() => (weights.length ? [...weights].sort((a, b) => b.timestamp - a.timestamp)[0] : null), [weights]);
  const nutritionScore = useMemo(() => computeNutritionScore({ todayTotals, todayLogs, goals, waterMl: todayWater }), [todayTotals, todayLogs, goals, todayWater]);
  const yesterdayDateStr = useMemo(() => daysAgo(1), []);
  const yesterdayLogsForScore = useMemo(() => logs.filter((l) => l.date === yesterdayDateStr), [logs, yesterdayDateStr]);
  const yesterdayTotalsForScore = useMemo(() => yesterdayLogsForScore.reduce((acc, l) => ({
    calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g), fiber: acc.fiber + num(l.fiber_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }), [yesterdayLogsForScore]);
  const yesterdayWaterForScore = useMemo(() => waterLogs.filter((w) => w.date === yesterdayDateStr).reduce((s, w) => s + num(w.ml), 0), [waterLogs, yesterdayDateStr]);
  const yesterdayNutritionScore = useMemo(() => (
    yesterdayLogsForScore.length > 0
      ? computeNutritionScore({ todayTotals: yesterdayTotalsForScore, todayLogs: yesterdayLogsForScore, goals, waterMl: yesterdayWaterForScore })
      : null
  ), [yesterdayLogsForScore, yesterdayTotalsForScore, goals, yesterdayWaterForScore]);
  const microSummary = useMemo(() => computeMicronutrientSummary(todayLogs, goals), [todayLogs, goals, darkMode]);
  const weeklyAchievement = useMemo(() => computeWeeklyAchievement(logs, goals), [logs, goals]);
  const mealDates = useMemo(() => new Set(logs.map((l) => l.date)), [logs]);
  const exerciseDates = useMemo(() => new Set(exerciseLogs.map((e) => e.date)), [exerciseLogs]);
  const personalRecords = useMemo(() => computePersonalRecords(exerciseLogs), [exerciseLogs]);
  // Note: computeTodayStatus reads colors off the module-level `C` object, which
  // is reassigned (not replaced) when darkMode toggles — so darkMode must be an
  // explicit dependency here, or the memo keeps serving stale light/dark colors
  // (this was the cause of the status card staying white in dark mode).
  const todayStatus = useMemo(() => computeTodayStatus({ todayTotals, goals, todayLogs }), [todayTotals, goals, todayLogs, darkMode]);
  const viewedStatus = useMemo(() => (viewedIsToday ? todayStatus : computeTodayStatus({ todayTotals: viewedTotals, goals, todayLogs: viewedLogs })), [viewedIsToday, todayStatus, viewedTotals, goals, viewedLogs, darkMode]);

  // ---------- Micro-interactions: celebrations + pulses ----------
  // Two tiers: `pulse` is a brief centered icon for routine confirmations (meal
  // logged, weight updated, workout completed); `celebrations` is a dismissible
  // top banner reserved for milestones (streak up, protein target hit, daily
  // goal completed). Achievement crossings are detected by comparing against a
  // ref of the previous value so they fire once, right when the threshold is
  // crossed, not on every render.
  const [justAddedId, setJustAddedId] = useState(null);
  const [pulse, setPulse] = useState(null);
  const pulseTimerRef = useRef(null);
  function firePulse(kind) {
    const defs = {
      meal: { icon: Utensils, color: C.orange, bg: C.orangeTint },
      weight: { icon: Scale, color: C.blue, bg: C.blueTint },
      workout: { icon: Dumbbell, color: C.blue, bg: C.blueTint },
      sleep: { icon: Moon, color: C.purple, bg: C.purpleTint },
    };
    clearTimeout(pulseTimerRef.current);
    setPulse({ ...(defs[kind] || defs.meal), kind });
    pulseTimerRef.current = setTimeout(() => setPulse(null), 850);
  }
  const [celebrations, setCelebrations] = useState([]);
  function fireCelebration(c) {
    haptic("achievement");
    const id = uid();
    setCelebrations((cs) => [...cs, { id, ...c }]);
    setTimeout(() => setCelebrations((cs) => cs.filter((x) => x.id !== id)), 3200);
  }
  function dismissCelebration(id) { setCelebrations((cs) => cs.filter((x) => x.id !== id)); }

  // Guards against firing achievement celebrations while historical data is
  // first loading in (e.g. an existing 5-day streak shouldn't "celebrate" on open).
  const justLoadedRef = useRef(true);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => { justLoadedRef.current = false; }, 1000);
    return () => clearTimeout(t);
  }, [ready]);

  const prevStreakRef = useRef(streak);
  useEffect(() => {
    if (ready && !justLoadedRef.current && streak > prevStreakRef.current) {
      fireCelebration({ icon: Trophy, color: C.pink, bg: C.pinkTint, text: `🔥 ${streak}-day streak!` });
    }
    prevStreakRef.current = streak;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streak, ready]);

  const prevProteinHitRef = useRef(false);
  useEffect(() => {
    const hit = goals.protein > 0 && todayTotals.protein >= goals.protein;
    if (ready && !justLoadedRef.current && hit && !prevProteinHitRef.current) {
      fireCelebration({ icon: Dumbbell, color: C.purple, bg: C.purpleTint, text: "💪 Protein target reached!" });
    }
    prevProteinHitRef.current = hit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayTotals.protein, goals.protein, ready]);

  const prevGoalHitRef = useRef(false);
  useEffect(() => {
    const hit = todayStatus.level === "achieved";
    if (ready && !justLoadedRef.current && hit && !prevGoalHitRef.current) {
      fireCelebration({ icon: Trophy, color: C.green, bg: C.greenTint, text: "🏆 Daily goal completed!" });
    }
    prevGoalHitRef.current = hit;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayStatus.level, ready]);

  // ---------- Smart notifications ----------
  const [dismissedNotifications, setDismissedNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [nowTick, setNowTick] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 5 * 60 * 1000); // refresh pacing every 5min
    return () => clearInterval(id);
  }, []);
  const smartNotifications = useMemo(
    () => computeSmartNotifications({ todayTotals, todayLogs, goals, todayWater, now: nowTick }).filter((n) => !dismissedNotifications.includes(n.id)),
    [todayTotals, todayLogs, goals, todayWater, nowTick, dismissedNotifications, darkMode]
  );

  // ---------- AI Daily Coach ----------
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachError, setCoachError] = useState(null);
  async function generateDailyCoach() {
    setCoachLoading(true); setCoachError(null);
    try {
      const promptText = buildDailyCoachPrompt({ todayTotals, todayLogs, exerciseLogs: todayExerciseLogs, goals });
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      const next = { date: todayStr(), summary: parsed.summary || "", suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [], generatedAt: Date.now() };
      await persistDailyCoach(next);
    } catch (e) {
      setCoachError(e && e.message ? e.message : "Couldn't generate today's coach summary.");
    } finally { setCoachLoading(false); }
  }
  // Auto-generate once per day, in the evening, once there's at least one meal
  // logged and we haven't already generated today's summary.
  useEffect(() => {
    if (!ready) return;
    const hour = nowTick.getHours();
    if (hour >= 20 && todayLogs.length > 0 && (!dailyCoach || dailyCoach.date !== todayStr()) && !coachLoading) {
      generateDailyCoach();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nowTick, todayLogs.length, dailyCoach]);

  // ---------- Weekly AI Review ----------
  const [weeklyReviewLoading, setWeeklyReviewLoading] = useState(false);
  const [weeklyReviewError, setWeeklyReviewError] = useState(null);
  const currentWeekStart = daysAgo(6);
  async function generateWeeklyReview() {
    setWeeklyReviewLoading(true); setWeeklyReviewError(null);
    try {
      const stats = computeWeeklyReviewStats(logs, exerciseLogs, waterLogs, weights, goals);
      const promptText = buildWeeklyReviewPrompt(stats);
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      const next = { weekStart: currentWeekStart, summary: parsed.summary || "", focusNextWeek: parsed.focus_next_period || "", generatedAt: Date.now() };
      await persistWeeklyReview(next);
    } catch (e) {
      setWeeklyReviewError(e && e.message ? e.message : "Couldn't generate this week's review.");
    } finally { setWeeklyReviewLoading(false); }
  }
  // Auto-generate once every 7 days (by rolling week-start, not calendar week),
  // once there's at least 3 days of logs in the current window, evenings only.
  useEffect(() => {
    if (!ready) return;
    const hour = nowTick.getHours();
    const daysLoggedThisWindow = new Set(logs.filter((l) => l.date >= currentWeekStart).map((l) => l.date)).size;
    if (hour >= 19 && daysLoggedThisWindow >= 3 && (!weeklyReview || weeklyReview.weekStart !== currentWeekStart) && !weeklyReviewLoading) {
      generateWeeklyReview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nowTick, currentWeekStart, logs.length, weeklyReview]);

  // ---------- Monthly AI Review ----------
  const [monthlyReviewLoading, setMonthlyReviewLoading] = useState(false);
  const [monthlyReviewError, setMonthlyReviewError] = useState(null);
  const currentMonthStart = daysAgo(29);
  async function generateMonthlyReview() {
    setMonthlyReviewLoading(true); setMonthlyReviewError(null);
    try {
      const stats = computeMonthlyReviewStats(logs, exerciseLogs, waterLogs, weights, goals);
      const promptText = buildMonthlyReviewPrompt(stats);
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      const next = { monthStart: currentMonthStart, summary: parsed.summary || "", focusNextMonth: parsed.focus_next_period || "", generatedAt: Date.now() };
      await persistMonthlyReview(next);
    } catch (e) {
      setMonthlyReviewError(e && e.message ? e.message : "Couldn't generate this month's review.");
    } finally { setMonthlyReviewLoading(false); }
  }
  // Auto-generate once every 30 days (by rolling month-start), once there's
  // meaningfully enough logging history in the window, evenings only.
  useEffect(() => {
    if (!ready) return;
    const hour = nowTick.getHours();
    const daysLoggedThisWindow = new Set(logs.filter((l) => l.date >= currentMonthStart).map((l) => l.date)).size;
    if (hour >= 19 && daysLoggedThisWindow >= 10 && (!monthlyReview || monthlyReview.monthStart !== currentMonthStart) && !monthlyReviewLoading) {
      generateMonthlyReview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, nowTick, currentMonthStart, logs.length, monthlyReview]);

  

if (authLoading) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{
        height: "100vh",
        background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`,
        color: C.ink,
        gap: 14,
      }}
    >
      <style>{`
        @keyframes splashGlow { 0% { opacity: 0; transform: scale(0.8); box-shadow: 0 0 0px 0px rgba(238,108,55,0); } 55% { opacity: 1; transform: scale(1.08); box-shadow: 0 0 28px 10px rgba(238,108,55,0.35); } 100% { opacity: 1; transform: scale(1); box-shadow: 0 0 16px 3px rgba(238,108,55,0.18); } }
        .anim-splash-glow { animation: splashGlow 1s cubic-bezier(.22,.9,.34,1) both; }
        @keyframes splashWordmarkIn { 0% { opacity: 0; transform: translateY(6px); } 100% { opacity: 1; transform: translateY(0); } }
        .anim-splash-wordmark { animation: splashWordmarkIn .6s ease .35s both; }
        @keyframes splashSpinnerIn { 0% { opacity: 0; } 100% { opacity: 1; } }
        .anim-splash-spinner { animation: splashSpinnerIn .5s ease .8s both; }
      `}</style>
      <div className="anim-splash-glow flex items-center justify-center" style={{ width: 64, height: 64, borderRadius: "50%", background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})` }}>
        <Leaf size={30} color="#fff" />
      </div>
      <span className="anim-splash-wordmark ft-display" style={{ fontSize: 22, fontWeight: 700, color: C.ink }}>Nourish</span>
      <Loader2 className="animate-spin anim-splash-spinner" size={20} color={C.orange} style={{ marginTop: 6 }} />
    </div>
  );
}

if (!user) {
  return (
    <div
      className="flex flex-col items-center justify-center px-6"
      style={{
        height: "100vh",
        background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`,
        color: C.ink,
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 24,
          background: C.orangeTint,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 20,
          fontSize: 32,
        }}
      >
        🥗
      </div>

      <div
        style={{
          fontSize: 30,
          fontWeight: 800,
          letterSpacing: "-0.8px",
          marginBottom: 8,
        }}
      >
        Nourish
      </div>

      <div
        style={{
          fontSize: 15,
          color: C.inkSoft,
          maxWidth: 300,
          lineHeight: 1.5,
          marginBottom: 32,
        }}
      >
        Your personal nutrition, fitness, and AI-powered health companion.
      </div>

      <button
        onClick={handleGoogleSignIn}
        style={{
          width: "100%",
          maxWidth: 320,
          height: 52,
          borderRadius: 16,
          border: `1px solid ${C.line}`,
          background: C.card,
          color: C.ink,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          fontSize: 15,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 4px 16px rgba(0,0,0,0.06)",
        }}
      >
        <span style={{ fontSize: 20 }}>G</span>
        Continue with Google
      </button>

      <div
        style={{
          marginTop: 18,
          fontSize: 12.5,
          color: C.inkSoft,
          maxWidth: 290,
          lineHeight: 1.5,
        }}
      >
        Sign in to securely back up and sync your Nourish data.
      </div>
    </div>
  );
}

if (!ready) return <div className="flex items-center justify-center" style={{ height: "100dvh", background: C.bgTop }}><Loader2 className="animate-spin" size={22} color={C.orange} /></div>;


  const trimmedName = profile.name ? profile.name.trim() : "";
  const initial = trimmedName ? trimmedName[0].toUpperCase() : "U";
  const eatenPct = goals.calories > 0 ? (todayTotals.calories / goals.calories) * 100 : 0;
  // Config for the Insights nutrition chart's Calories/Protein/Carbs/Fat tabs —
  // colors pull from the current (light/dark) C so the chart stays in sync.
  const NUTRITION_CHART_METRICS = [
    { key: "calories", label: "Calories", unit: " kcal", color: C.orange },
    { key: "protein", label: "Protein", unit: "g", color: C.purple },
    { key: "carbs", label: "Carbs", unit: "g", color: C.tan },
    { key: "fat", label: "Fat", unit: "g", color: C.pink },
  ];
  const remaining = Math.max(0, Math.round(goals.calories - todayTotals.calories));
  const viewedEatenPct = goals.calories > 0 ? (viewedTotals.calories / goals.calories) * 100 : 0;
  const viewedRemaining = Math.max(0, Math.round(goals.calories - viewedTotals.calories));

  return (
    <div className="flex flex-col relative" style={{ height: "100dvh", background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, overflow: "hidden" }}>
      <MicroInteractionStyles />
      <MicroPulse pulse={pulse} />
      <CelebrationBanner celebrations={celebrations} onDismiss={dismissCelebration} />
      <UndoToast toast={undoToast} onUndo={handleUndoTap} />
            <div ref={scrollRef} onTouchStart={onPullTouchStart} onTouchMove={onPullTouchMove} onTouchEnd={onPullTouchEnd}
              className="flex-1 overflow-y-auto px-4 pt-5" style={{ paddingBottom: 90 }}>

              {(pullDistance > 0 || refreshing || refreshSuccess) && (
                <div className="flex items-center justify-center" style={{ height: refreshing || refreshSuccess ? 40 : pullDistance, transition: refreshing || refreshSuccess ? "height .2s ease" : "none", overflow: "hidden" }}>
                  <div className="flex items-center justify-center" style={{
                    width: 30, height: 30, borderRadius: "50%",
                    background: refreshSuccess ? C.greenTint : pullDistance > PULL_THRESHOLD || refreshing ? C.orangeTint : C.card,
                    transition: "background .2s ease, transform .2s cubic-bezier(.34,1.56,.64,1)",
                    transform: pullDistance > PULL_THRESHOLD && !refreshing ? "scale(1.12)" : "scale(1)",
                  }}>
                    {refreshSuccess ? (
                      <Check size={16} color={C.green} strokeWidth={3} className="anim-pop" />
                    ) : (
                      <Leaf size={15} color={refreshing || pullDistance > PULL_THRESHOLD ? C.orange : C.inkSoft}
                        className={refreshing ? "animate-spin" : ""}
                        style={{
                          transform: refreshing ? undefined : `rotate(${Math.min(pullDistance, PULL_THRESHOLD * 1.4) * 3}deg)`,
                          opacity: Math.min(1, pullDistance / (PULL_THRESHOLD * 0.6)),
                          transition: "transform .1s linear",
                        }} />
                    )}
                  </div>
                </div>
              )}

        <div className="flex items-center justify-between mb-5" style={{ position: "relative" }}>
          <div className="flex items-center gap-3">
            <Avatar initial={initial} />
            <div>
              <div className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 500 }}>{greeting()}</div>
              <input value={profile.name} onChange={(e) => persistProfile({ ...profile, name: e.target.value })} placeholder="Add your name"
                className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: profile.name ? C.ink : C.inkSoft, background: "transparent", border: "none", outline: "none", width: "100%" }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cloudSyncing && (
              <div className="relative flex items-center justify-center" style={{ width: 24, height: 24 }} title="Backing up">
                <div className="anim-cloud-ring" style={{ position: "absolute", inset: 0, borderRadius: "50%", border: `1.5px solid ${C.blue}` }} />
                <Cloud size={14} color={C.blue} className="anim-cloud-pulse" />
              </div>
            )}
            <button onClick={() => setNotifOpen((o) => !o)} className="relative flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: "50%", background: C.card }}>
              <Bell size={17} color={C.ink} />
              {smartNotifications.length > 0 && (
                <div style={{ position: "absolute", top: 6, right: 7, width: 8, height: 8, borderRadius: "50%", background: C.pink, border: `1.5px solid ${C.card}` }} />
              )}
            </button>
            <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Nourish</span>
          </div>
          {notifOpen && (
            <div className="absolute anim-notif-slide" style={{ top: 44, right: 0, width: 280, zIndex: 40, background: C.card, borderRadius: 16, boxShadow: "0 10px 30px rgba(20,20,20,0.2)", padding: 12 }}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Notifications</span>
                <button onClick={() => setNotifOpen(false)}><X size={15} color={C.inkSoft} /></button>
              </div>
              {smartNotifications.length === 0 ? (
                <div className="py-4 text-center ft-body" style={{ fontSize: 12, color: C.inkSoft }}>You're all caught up.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {smartNotifications.map((n, i) => (
                    <div key={n.id} className="anim-notif-slide flex items-start gap-2 p-2.5" style={{ background: n.bg, borderRadius: 12, animationDelay: `${i * 70}ms`, animationFillMode: "backwards" }}>
                      <span className="relative flex items-center justify-center anim-notif-pulse-dot" style={{ flexShrink: 0, marginTop: 1, borderRadius: "50%" }}>
                        <n.icon size={14} color={n.color} />
                      </span>
                      <span className="ft-body flex-1" style={{ fontSize: 12, color: C.ink, lineHeight: 1.35 }}>{n.text}</span>
                      <button onClick={() => setDismissedNotifications((d) => [...d, n.id])} style={{ flexShrink: 0 }}><X size={12} color={C.inkSoft} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={tabTransitionStyle()}>
        {tab === "home" && (
          <>
            {/* Sliding day content — date header, status, ring, macro pills,
                and the Score/Weight/Sleep/Water tiles all live inside this
                one block so they move together as a single unit during the
                day-swipe transition (AI Daily Coach below is intentionally
                outside it — it's today-only and unrelated to which day is
                being viewed). */}
            <div style={dayTransitionStyle()}>
            {/* Date slider — swipe left/right anywhere on Home, tap the arrows, tap
                any of the three visible dates, or tap the calendar icon to jump
                straight to any date (no limit — goes all the way back) */}
            {(() => {
              const labelForOffset = (o) => (o === 0 ? "Today" : o === 1 ? "Yesterday" : fmtDate(daysAgo(o)));
              const offsets = [dashDayOffset + 1, dashDayOffset, dashDayOffset - 1];
              return (
                <div className="flex items-center gap-1.5 mb-3 px-1 anim-card-in">
                  <button onClick={() => animateDayChange(dashDayOffset + 1, "left")} className="flex items-center justify-center flex-shrink-0" style={{ width: 26, height: 26, borderRadius: "50%", background: C.card }}><ChevronLeft size={14} color={C.ink} /></button>
                  <div className="flex-1 flex items-center gap-1.5">
                    {offsets.map((o) => {
                      const isFuture = o < 0;
                      const active = o === dashDayOffset;
                      return (
                        <button key={o} onClick={() => !isFuture && animateDayChange(o, o > dashDayOffset ? "left" : "right")} disabled={isFuture}
                          className="flex-1 ft-body" style={{
                            padding: "8px 4px", borderRadius: 12, border: "none",
                            background: active ? C.ink : C.card,
                            color: active ? C.onInk : C.inkSoft,
                            fontSize: 12, fontWeight: active ? 700 : 500,
                            opacity: isFuture ? 0 : 1, pointerEvents: isFuture ? "none" : "auto",
                            transition: "background .2s ease, color .2s ease",
                          }}>{isFuture ? "" : <span className={active ? "anim-date-flip" : ""} style={{ display: "inline-block" }}>{labelForOffset(o)}</span>}</button>
                      );
                    })}
                  </div>
                  <button onClick={() => animateDayChange(Math.max(dashDayOffset - 1, 0), "right")} disabled={viewedIsToday} className="flex items-center justify-center flex-shrink-0" style={{ width: 26, height: 26, borderRadius: "50%", background: C.card, opacity: viewedIsToday ? 0.35 : 1 }}><ChevronRight size={14} color={C.ink} /></button>
                  <div className="relative flex items-center justify-center flex-shrink-0">
                    <button
                      onClick={() => {
                        const el = dateJumpInputRef.current;
                        if (!el) return;
                        if (el.showPicker) el.showPicker(); else el.click();
                      }}
                      className="flex items-center justify-center" title="Jump to date"
                      style={{ width: 26, height: 26, borderRadius: "50%", background: C.card }}>
                      <CalendarDays size={13} color={C.ink} />
                    </button>
                    <input
                      ref={dateJumpInputRef}
                      type="date"
                      value={viewedDate}
                      max={todayStr()}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (!val) return;
                        const newOffset = Math.max(0, offsetFromDateStr(val));
                        animateDayChange(newOffset, newOffset > dashDayOffset ? "left" : "right");
                      }}
                      style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", width: 26, height: 26 }}
                    />
                  </div>
                </div>
              );
            })()}

            {/* Today's Status — the app's one-glance answer to "how am I doing today" */}
            <div className="p-4 mb-4 anim-card-scale-in" style={{ background: viewedStatus.bg, borderRadius: 16, transition: "background .3s ease", animationDelay: "60ms" }}>
              <div className="flex items-center justify-between">
                <span className="ft-display" style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{viewedStatus.emoji} {viewedStatus.label}</span>
                {viewedStatus.level === "achieved" && <Trophy size={17} color={viewedStatus.color} />}
              </div>
              {viewedStatus.level !== "empty" && (
                <>
                  <div className="ft-body mt-1" style={{ fontSize: 12.5, color: C.ink, opacity: 0.85 }}>
                    Protein: <AnimatedNumber value={viewedStatus.proPct} />% • Calories: <AnimatedNumber value={viewedStatus.calPct} />%
                  </div>
                  <div className="ft-mono mt-0.5" style={{ fontSize: 12, color: C.ink, opacity: 0.7 }}>
                    {viewedStatus.remaining >= 0 ? <><AnimatedNumber value={viewedStatus.remaining} /> kcal remaining</> : <><AnimatedNumber value={Math.abs(viewedStatus.remaining)} /> kcal over</>}
                  </div>
                </>
              )}
            </div>

            <div className="p-5 mb-4 anim-card-in" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", animationDelay: "120ms" }}>
              <div className="flex items-center justify-between">
                <Ring size={190} stroke={16} pct={viewedEatenPct} trackColor={C.track} fillColor={C.orange}>
                  <div className="flex flex-col items-center">
                    <span className="ft-display" style={{ fontSize: 32, fontWeight: 700, color: C.ink }}><AnimatedNumber value={viewedRemaining} /></span>
                    <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 500 }}>kcal left</span>
                  </div>
                </Ring>
                <div className="flex flex-col gap-4 pl-2">
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Flame size={16} color={C.orange} /></div>
                    <div><div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}><AnimatedNumber value={viewedTotals.calories} /></div><div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>/ {goals.calories} kcal goal</div></div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: C.greenTint, display: "flex", alignItems: "center", justifyContent: "center" }}><ClipboardList size={16} color={C.green} /></div>
                    <div><div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{viewedLogs.length}</div><div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>meals logged</div></div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Flame size={16} color={C.pink} className={streak > 0 ? "anim-flame-flicker" : ""} />
                    </div>
                    <div><div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}><AnimatedNumber value={streak} /></div><div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>day streak</div></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 mb-2.5 anim-card-in" style={{ animationDelay: "180ms" }}>
              <MacroPill icon={Dumbbell} iconBg={C.purpleTint} iconColor={C.purple} label="Protein" value={Math.round(viewedTotals.protein)} unit="g" pct={goals.protein > 0 ? (viewedTotals.protein / goals.protein) * 100 : 0} />
              <MacroPill icon={Wheat} iconBg={C.tanTint} iconColor={C.tan} label="Carbs" value={Math.round(viewedTotals.carbs)} unit="g" pct={goals.carbs > 0 ? (viewedTotals.carbs / goals.carbs) * 100 : 0} />
              <MacroPill icon={Droplet} iconBg={C.pinkTint} iconColor={C.pink} label="Fat" value={Math.round(viewedTotals.fat)} unit="g" pct={goals.fat > 0 ? (viewedTotals.fat / goals.fat) * 100 : 0} />
            </div>
            <div className="flex gap-2.5 mb-4 anim-card-in" style={{ animationDelay: "230ms" }}>
              <MacroPill icon={Droplets} iconBg={C.blueTint} iconColor={C.blue} label="Water" value={Math.round((viewedIsToday ? todayWater : viewedWater) / 1000 * 10) / 10} unit="L" pct={goals.water > 0 ? ((viewedIsToday ? todayWater : viewedWater) / goals.water) * 100 : 0} />
              <MacroPill icon={Dumbbell} iconBg={viewedExerciseLogs.length > 0 ? C.greenTint : isSundayDate(viewedDate) ? C.tanTint : C.greenTint} iconColor={viewedExerciseLogs.length > 0 ? C.green : isSundayDate(viewedDate) ? C.tan : C.green} label="Workout" value={viewedExerciseLogs.length > 0 ? "Done" : isSundayDate(viewedDate) ? "Holiday" : "Rest"} unit="" pct={viewedExerciseLogs.length > 0 || isSundayDate(viewedDate) ? 100 : 0} />
            </div>

            {!viewedIsToday ? (
              <>
                <div onClick={() => setShowScore(true)} className="p-4 mb-4 anim-card-in" style={{ background: C.card, borderRadius: 16, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", cursor: "pointer", animationDelay: "290ms" }}>
                  <div className="flex items-center gap-3">
                    <div style={{ width: 46, height: 46, borderRadius: "50%", background: nutritionScore.total >= 80 ? C.greenTint : nutritionScore.total >= 55 ? C.tanTint : C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Gauge size={20} color={nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Today's Nutrition Score</span>
                        <span className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color: nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink }}><AnimatedNumber value={nutritionScore.total} />/100</span>
                      </div>
                      <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4, marginTop: 1 }}>{nutritionScore.summary}</div>
                    </div>
                  </div>
                </div>
                <div className="p-4 mb-6 flex items-center gap-2.5 anim-card-in" style={{ background: C.card, borderRadius: 16, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", animationDelay: "350ms" }}>
                  <CalendarDays size={16} color={C.inkSoft} />
                  <span className="ft-body flex-1" style={{ fontSize: 12.5, color: C.inkSoft }}>Viewing {fmtDate(viewedDate)}'s log. Weight, sleep, water tracking and the AI coach only run for today.</span>
                  <button onClick={() => setDashDayOffset(0)} className="ft-body flex-shrink-0" style={{ fontSize: 12, color: C.orange, fontWeight: 600 }}>Back to today</button>
                </div>
              </>
            ) : (
              // Score / Weight / Sleep / Water — 2x2 grid of big tiles
              <div className="grid grid-cols-2 gap-3 mb-6">
                {/* Score tile */}
                <div onClick={() => setShowScore(true)} className="p-4 anim-card-in" style={{ background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", cursor: "pointer", animationDelay: "290ms" }}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <div style={{ width: 30, height: 30, borderRadius: "50%", background: nutritionScore.total >= 80 ? C.greenTint : nutritionScore.total >= 55 ? C.tanTint : C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Gauge size={15} color={nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink} />
                    </div>
                    <span className="ft-display" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Score</span>
                  </div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="ft-display" style={{ fontSize: 26, fontWeight: 700, color: nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink }}><AnimatedNumber value={nutritionScore.total} /></span>
                    <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>/100</span>
                  </div>
                  <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{nutritionScore.summary}</div>
                </div>

                {/* Weight tile — tap through to the full Weight History screen */}
                <div onClick={() => setShowWeight(true)} className="p-4 anim-card-in" style={{ background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", cursor: "pointer", animationDelay: "340ms" }}>
                  <div className="flex items-center justify-between mb-2.5">
                    <div className="flex items-center gap-2">
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <Scale size={15} color={C.orange} />
                      </div>
                      <span className="ft-display" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Weight</span>
                    </div>
                    {latestWeight && (
                      <button onClick={(e) => { e.stopPropagation(); deleteWeightEntry(latestWeight.id); }} className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: "50%", background: C.bgBottom, border: "none", flexShrink: 0 }}>
                        <Minus size={10} color={C.inkSoft} />
                      </button>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1 mb-1.5">
                    <span className="ft-display" style={{ fontSize: 26, fontWeight: 700, color: C.ink }}>{latestWeight ? latestWeight.weight : "0.0"}</span>
                    <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>kg</span>
                  </div>
                  {weightAddOpen ? (
                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <input type="number" inputMode="decimal" autoFocus value={weightInputHome} onChange={(e) => setWeightInputHome(e.target.value)} placeholder="kg"
                        className="ft-mono" style={{ width: "100%", padding: "7px 10px", borderRadius: 12, border: "none", background: C.bgBottom, color: C.ink, fontSize: 13, outline: "none" }} />
                      <button
                        onClick={(e) => { e.stopPropagation(); const w = num(weightInputHome, null); if (w) { addWeightEntry(w); setWeightInputHome(""); setWeightAddOpen(false); } }}
                        className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: "50%", background: C.orange, flexShrink: 0 }}>
                        <Check size={13} color="#fff" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); setWeightAddOpen(true); }} className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.orange }}>Add Weight</button>
                  )}
                </div>

                {/* Sleep tile — tap through to the full Sleep Tracker screen. The
                    floating "Z" letters, twinkling stars, and moon glow/warning
                    cue are all purely decorative background layers, clipped to
                    this card's own bounds (overflow: hidden) so nothing bleeds
                    into neighboring tiles. Kept slow and low-opacity throughout
                    — this is a calm, ambient touch, not an attention-grabber. */}
                <button onClick={() => setShowSleep(true)} className="text-left p-4 anim-card-in" style={{ background: C.card, borderRadius: 20, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", border: "none", position: "relative", overflow: "hidden", animationDelay: "390ms" }}>
                  <style>{`
                    @keyframes sleepZFloat1 { 0% { transform: translate(0px, 6px) rotate(-4deg); opacity: 0; } 12% { opacity: 0.5; } 50% { transform: translate(10px, -30px) rotate(6deg); } 88% { opacity: 0.15; } 100% { transform: translate(-6px, -66px) rotate(-3deg); opacity: 0; } }
                    @keyframes sleepZFloat2 { 0% { transform: translate(0px, 6px) rotate(3deg); opacity: 0; } 15% { opacity: 0.55; } 50% { transform: translate(-9px, -28px) rotate(-7deg); } 85% { opacity: 0.15; } 100% { transform: translate(7px, -62px) rotate(4deg); opacity: 0; } }
                    @keyframes sleepZFloat3 { 0% { transform: translate(0px, 6px) rotate(-2deg); opacity: 0; } 18% { opacity: 0.45; } 50% { transform: translate(8px, -26px) rotate(5deg); } 82% { opacity: 0.12; } 100% { transform: translate(-8px, -58px) rotate(-5deg); opacity: 0; } }
                    .sleep-z-1 { animation: sleepZFloat1 4.2s ease-in-out infinite; }
                    .sleep-z-2 { animation: sleepZFloat2 3.6s ease-in-out infinite .9s; }
                    .sleep-z-3 { animation: sleepZFloat3 5s ease-in-out infinite 1.8s; }
                    @keyframes sleepTwinkle { 0%, 100% { opacity: 0.15; transform: scale(0.8); } 50% { opacity: 0.7; transform: scale(1); } }
                    .sleep-star { animation: sleepTwinkle 3.8s ease-in-out infinite; }
                    @keyframes sleepMoonGlow { 0%, 100% { box-shadow: 0 0 0px 0px rgba(139,127,209,0.4); } 50% { box-shadow: 0 0 12px 4px rgba(139,127,209,0.4); } }
                    .sleep-moon-good { animation: sleepMoonGlow 3.6s ease-in-out infinite; }
                    @keyframes sleepMoonWarn { 0%, 100% { box-shadow: 0 0 0px 0px rgba(227,162,58,0.35); } 50% { box-shadow: 0 0 0px 3px rgba(227,162,58,0.35); } }
                    .sleep-moon-warn { animation: sleepMoonWarn 3.6s ease-in-out infinite; }
                  `}</style>
                  <div className="sleep-star" style={{ position: "absolute", left: 22, top: 14, width: 3, height: 3, borderRadius: "50%", background: C.purple, pointerEvents: "none", animationDelay: "0s" }} />
                  <div className="sleep-star" style={{ position: "absolute", left: 44, top: 26, width: 2, height: 2, borderRadius: "50%", background: C.purple, pointerEvents: "none", animationDelay: "1.3s" }} />
                  <div className="sleep-star" style={{ position: "absolute", left: 64, top: 12, width: 2.5, height: 2.5, borderRadius: "50%", background: C.purple, pointerEvents: "none", animationDelay: "2.4s" }} />
                  <div className="sleep-z-1 ft-display" style={{ position: "absolute", right: 16, bottom: 10, fontSize: 13, fontWeight: 700, color: C.purple, pointerEvents: "none" }}>z</div>
                  <div className="sleep-z-2 ft-display" style={{ position: "absolute", right: 30, bottom: 10, fontSize: 17, fontWeight: 700, color: C.purple, pointerEvents: "none" }}>Z</div>
                  <div className="sleep-z-3 ft-display" style={{ position: "absolute", right: 10, bottom: 10, fontSize: 20, fontWeight: 700, color: C.purple, pointerEvents: "none" }}>Z</div>
                  <div style={{ position: "relative" }}>
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2">
                        <div className={
                          todaySleep && sleepQuality(todaySleep.durationMinutes, goals.sleep || SLEEP_GOAL_MINUTES) === "good" ? "sleep-moon-good"
                            : todaySleep && sleepQuality(todaySleep.durationMinutes, goals.sleep || SLEEP_GOAL_MINUTES) === "poor" ? "sleep-moon-warn" : ""
                        } style={{ width: 30, height: 30, borderRadius: "50%", background: C.purpleTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Moon size={15} color={C.purple} />
                        </div>
                        <span className="ft-display" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Sleep</span>
                      </div>
                      {todaySleep && (
                        <button onClick={(e) => { e.stopPropagation(); deleteSleep(todaySleep.id); }} className="flex items-center justify-center" style={{ width: 22, height: 22, borderRadius: "50%", background: C.bgBottom, border: "none", flexShrink: 0 }}>
                          <Minus size={10} color={C.inkSoft} />
                        </button>
                      )}
                    </div>
                    {todaySleep ? (
                      <>
                        <div className="ft-display mb-1" style={{ fontSize: 22, fontWeight: 700, color: C.ink }}><SleepDurationCountUp minutes={todaySleep.durationMinutes} /></div>
                        <div className="ft-mono mb-2" style={{ fontSize: 11.5, color: C.inkSoft }}>{fmtTime12(todaySleep.bedtime)} → {fmtTime12(todaySleep.wakeTime)}</div>
                        <div style={{ height: 5, borderRadius: 999, background: C.track, overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 999, background: C.purple, width: `${clamp((todaySleep.durationMinutes / (goals.sleep || SLEEP_GOAL_MINUTES)) * 100, 0, 100)}%`, transition: "width 1s cubic-bezier(.22,.9,.34,1)" }} />
                        </div>
                      </>
                    ) : (
                      <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft, fontStyle: "italic" }}>No sleep logged</span>
                    )}
                  </div>
                </button>

                {/* Water tile — keeps the animated wave fill */}
                <WaterWaveCard compact todayWater={todayWater} goalMl={goals.water} onAdd={() => addWater(250)} onRemove={removeLastWater} animationDelay="440ms" />
              </div>
            )}
            </div>

            {viewedIsToday && (
            <div className="p-4 mb-6 anim-card-in" style={{ background: C.card, borderRadius: 16, boxShadow: "0 2px 10px rgba(20,20,20,0.06)", animationDelay: "490ms" }}>
              <style>{`
                @keyframes coachIconSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                .coach-icon-spin { animation: coachIconSpin 1.8s linear infinite; }
                @keyframes coachWordIn { 0% { opacity: 0; transform: translateY(3px); } 100% { opacity: 1; transform: translateY(0); } }
                .coach-word-in { display: inline-block; animation: coachWordIn .3s ease both; }
                @keyframes coachSuggestionIn { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: translateY(0); } }
                .coach-suggestion-in { animation: coachSuggestionIn .4s cubic-bezier(.22,.9,.34,1) both; }
                @keyframes coachFocusPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
                .coach-focus-pulse { animation: coachFocusPulse 2.6s ease-in-out infinite; }
              `}</style>
              <div className="flex items-center gap-2 mb-2.5">
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.purpleTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {coachLoading ? <Sparkles size={15} color={C.purple} className="coach-icon-spin" /> : <Brain size={15} color={C.purple} />}
                </div>
                <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>AI Daily Coach</span>
              </div>
              {coachLoading ? (
                <div className="flex flex-col gap-2 py-1">
                  <SkeletonBlock width="92%" height={11} />
                  <SkeletonBlock width="76%" height={11} />
                  <SkeletonBlock width="55%" height={11} />
                </div>
              ) : dailyCoach && dailyCoach.date === todayStr() ? (
                <>
                  {/* Soft word-by-word reveal for the summary — reads like the
                      AI is actively writing it out, without a literal
                      character-by-character typewriter (which would be
                      slower to land and heavier to run for a 1-2 sentence
                      recap). Replays automatically each time a fresh recap
                      is generated, since this whole branch remounts then. */}
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>
                    {dailyCoach.summary.split(/(\s+)/).map((chunk, i) =>
                      /^\s+$/.test(chunk)
                        ? chunk
                        : <span key={i} className="coach-word-in" style={{ animationDelay: `${i * 14}ms` }}>{chunk}</span>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 mb-2">
                    {dailyCoach.suggestions.map((s, i) => {
                      const isFocus = i === dailyCoach.suggestions.length - 1 && dailyCoach.suggestions.length > 1;
                      return (
                        <div key={i} className="coach-suggestion-in" style={{ animationDelay: `${220 + i * 160}ms` }}>
                          {isFocus && (
                            <div className="ft-body mb-0.5" style={{ fontSize: 10, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: 0.4 }}>Tomorrow's focus</div>
                          )}
                          <div className={"flex items-start gap-2" + (isFocus ? " coach-focus-pulse" : "")}>
                            <Lightbulb size={13} color={C.tan} style={{ flexShrink: 0, marginTop: 2 }} />
                            <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>{s}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={generateDailyCoach} className="ft-body" style={{ fontSize: 12.5, color: C.purple, fontWeight: 600 }}>Refresh</button>
                </>
              ) : (
                <>
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.4 }}>
                    {todayLogs.length === 0 ? "Log a meal today and check back for your evening recap." : "Get a quick recap of today's nutrition with tips for tomorrow."}
                  </div>
                  <button onClick={generateDailyCoach} disabled={todayLogs.length === 0} className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full ft-body"
                    style={{ background: C.ink, color: C.onInk, fontSize: 12, fontWeight: 600, opacity: todayLogs.length === 0 ? 0.5 : 1 }}>
                    <Sparkles size={13} />Get today's recap
                  </button>
                </>
              )}
              {coachError && <div className="ft-body mt-2" style={{ fontSize: 12.5, color: C.pink }}>{coachError}</div>}
            </div>
            )}
          </>
        )}

        {tab === "logs" && (
          <div>
            <MiniCalendar mealDates={mealDates} exerciseDates={exerciseDates} selectedDate={logsDateFilter} onSelectDate={setLogsDateFilter} />
            {logsDateFilter && (
              <div className="flex items-center justify-between mb-3 px-1">
                <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>Showing {fmtDate(logsDateFilter)} only</span>
                <button onClick={() => setLogsDateFilter(null)} className="ft-body" style={{ fontSize: 12, color: C.orange, fontWeight: 600 }}>Clear</button>
              </div>
            )}
            <div className="flex gap-2 mb-4">
              <Chip active={logsSubTab === "meals"} onClick={() => setLogsSubTab("meals")} label={`Meals (${logsDateFilter ? logs.filter((l) => l.date === logsDateFilter).length : logs.length})`} />
              <Chip active={logsSubTab === "exercise"} onClick={() => setLogsSubTab("exercise")} label={`Exercise (${logsDateFilter ? exerciseLogs.filter((e) => e.date === logsDateFilter).length : exerciseLogs.length})`} />
            </div>
            {logsSubTab === "meals" ? (() => {
              const visibleMeals = logsDateFilter ? logs.filter((l) => l.date === logsDateFilter) : logs;
              if (visibleMeals.length === 0) {
                return <EmptyState icon={Utensils} text={logsDateFilter ? "No meals logged on this day." : "Nothing logged yet. Tap the orange + button to add your first meal."} />;
              }
              const renderMeal = (l, virtualized) => {
                const items = splitFoodItems(l.food_name);
                const itemsLine = items.length > 1
                  ? items.map((it) => `${foodEmoji(it)} ${it}`).join(" · ")
                  : `${foodEmoji(l.food_name)} ${l.food_name}`;
                const hasThumb = l.source === "photo" && !!l.photo_thumb;
                const isExpanded = !virtualized && expandedMealId === l.id;
                return (
                <SwipeRow onEdit={() => openEdit("meal", l)} onDuplicate={() => duplicateLog(l)} onDelete={() => deleteLog(l.id)}>
                  <div onClick={() => !virtualized && setExpandedMealId(isExpanded ? null : l.id)}
                    className={"p-3.5" + (l.id === justAddedId ? " anim-row-flash anim-row-slide-in" : "")}
                    style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)", boxSizing: "border-box", height: virtualized ? "100%" : undefined, cursor: virtualized ? "default" : "pointer" }}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        {hasThumb ? (
                          <img src={l.photo_thumb} alt="" style={{ width: 42, height: 42, borderRadius: 12, objectFit: "cover", flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Utensils size={15} color={C.orange} /></div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="ft-body" style={{ fontSize: 12, fontWeight: 700, color: C.orange, letterSpacing: 0.4, textTransform: "uppercase" }}>{mealPeriodLabel(l.timestamp)}</span>
                            <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{fmtTime(l.timestamp)}</span>
                          </div>
                          <div className="ft-body" style={{ fontSize: 15, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{itemsLine}</div>
                          <div className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{Math.round(l.calories)} kcal | {Math.round(l.protein_g)}g protein</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(l); }} className="p-2" title="Favorite">
                          <Star size={14} color={C.tan} fill={favorites.some((f) => (f.food_name || "").trim().toLowerCase() === (l.food_name || "").trim().toLowerCase()) ? C.tan : "none"} />
                        </button>
                        {!virtualized && <ChevronDown size={15} color={C.inkSoft} className="meal-chevron" style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)" }} />}
                      </div>
                    </div>

                    {!virtualized && (
                      <div className="meal-card-expand-wrap" style={{ gridTemplateRows: isExpanded ? "1fr" : "0fr" }}>
                        <div style={{ minHeight: 0, overflow: "hidden" }}>
                          <div className={isExpanded ? "anim-meal-detail-in" : ""} style={{ paddingTop: 12, marginTop: 12, borderTop: `1px solid ${C.line}` }} onClick={(e) => e.stopPropagation()}>
                            {l.estimated_portion && (
                              <div className="ft-body mb-2" style={{ fontSize: 12, color: C.inkSoft }}>{l.estimated_portion}</div>
                            )}
                            <div className="flex gap-2 mb-2.5">
                              {[["Protein", l.protein_g, C.green, C.greenTint], ["Carbs", l.carbs_g, C.tan, C.tanTint], ["Fat", l.fat_g, C.pink, C.pinkTint], ["Fiber", l.fiber_g, C.purple, C.purpleTint]].map(([label, val, color, bg]) => (
                                <div key={label} className="flex-1 flex flex-col items-center py-2 rounded-xl" style={{ background: bg }}>
                                  <span className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color }}>{Math.round(num(val))}g</span>
                                  <span className="ft-body" style={{ fontSize: 10, color: C.inkSoft }}>{label}</span>
                                </div>
                              ))}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {isExpanded && mealTags(l).map((t, i) => <TagChip key={t.label} label={t.label} color={t.color} bg={t.bg} index={i} />)}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </SwipeRow>
              );};
              // Hundreds of entries render efficiently via windowing; short lists use
              // the normal flow layout so they don't get boxed into a fixed height.
              if (visibleMeals.length > VIRTUALIZE_THRESHOLD) {
                return <VirtualList items={visibleMeals} itemHeight={78} gap={10} height={480} renderItem={(l) => renderMeal(l, true)} />;
              }
              return <div className="flex flex-col gap-2.5">{visibleMeals.map((l) => <div key={l.id}>{renderMeal(l, false)}</div>)}</div>;
            })() : (() => {
              const visibleExercise = logsDateFilter ? exerciseLogs.filter((e) => e.date === logsDateFilter) : exerciseLogs;
              if (visibleExercise.length === 0) {
                return <EmptyState icon={Dumbbell} text={logsDateFilter ? "No workouts logged on this day." : "No workouts logged yet. Tap the orange + button and choose Exercise."} />;
              }
              return (
                <div className="flex flex-col gap-2.5">
                  {!logsDateFilter && Object.keys(personalRecords).length > 0 && (
                    <div className="p-3.5 mb-1" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Award size={14} color={C.tan} />
                        <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Personal records</span>
                      </div>
                      <div className="flex gap-2" style={{ overflowX: "auto", minWidth: 0, width: "100%" }}>
                        {Object.values(personalRecords).map((r) => (
                          <div key={r.name} className="flex-shrink-0 px-3 py-2" style={{ background: C.tanTint, borderRadius: 12, minWidth: 110 }}>
                            <div className="ft-body" style={{ fontSize: 12, color: C.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{r.name}</div>
                            <div className="ft-mono" style={{ fontSize: 13, fontWeight: 700, color: C.tan }}>{r.weight}kg × {r.reps}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {visibleExercise.map((e) => {
                    const volume = e.type === "strength" ? e.sets.reduce((s, x) => s + num(x.weight) * num(x.reps), 0) : 0;
                    const overload = computeProgressiveOverload(e, exerciseLogs.filter((x) => x.timestamp < e.timestamp));
                    const isNewEntry = e.id === justAddedId;
                    return (
                      <SwipeRow key={e.id} onEdit={() => openEdit("exercise", e)} onDuplicate={() => duplicateExercise(e)} onDelete={() => deleteExercise(e.id)}>
                      <div className={"p-3.5" + (isNewEntry ? " anim-row-flash anim-row-slide-in" : "")} style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0">
                            <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {e.type === "strength" ? <Dumbbell size={15} color={C.blue} className={isNewEntry ? "anim-icon-lift" : ""} /> : <Activity size={15} color={C.blue} className={isNewEntry ? "anim-icon-lift" : ""} />}
                            </div>
                            <div className="min-w-0">
                              <div className="ft-body" style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{e.name}</div>
                              <div className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>
                                {fmtDateTime(e.timestamp)} · {e.type === "strength"
                                  ? <><CountUp value={e.sets.length} active={isNewEntry} /> sets · <CountUp value={Math.round(volume)} active={isNewEntry} /> kg volume</>
                                  : <><CountUp value={e.duration_min} active={isNewEntry} />min · <CountUp value={e.distance_km} active={isNewEntry} decimals={e.distance_km % 1 !== 0 ? 1 : 0} />km</>}
                              </div>
                              {overload && overload.isPR && (
                                <div className={"flex items-center gap-1 mt-1" + (isNewEntry ? " anim-pr-badge" : "")}><Award size={11} color={C.tan} /><span className="ft-body" style={{ fontSize: 12, color: C.tan, fontWeight: 700 }}>New PR</span></div>
                              )}
                              {overload && !overload.isPR && !overload.isNew && overload.deltaWeight !== 0 && (
                                <div className={"flex items-center gap-1 mt-1" + (isNewEntry ? " anim-insight-in" : "")}>
                                  {overload.deltaWeight > 0 ? <TrendingUp size={11} color={C.green} /> : <TrendingDown size={11} color={C.pink} />}
                                  <span className="ft-body" style={{ fontSize: 12, color: overload.deltaWeight > 0 ? C.green : C.pink, fontWeight: 600 }}>
                                    {overload.deltaWeight > 0 ? "+" : ""}<CountUp value={Math.round(overload.deltaWeight * 10) / 10} active={isNewEntry} decimals={1} />kg top set vs last time
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        {e.ai && (
                          <div className={"mt-2.5 pt-2.5" + (isNewEntry ? " anim-insight-in" : "")} style={{ borderTop: `1px solid ${C.line}` }}>
                            <div className="flex items-center justify-between mb-1.5">
                              <TrendBadge trend={e.ai.trend} />
                              <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>~<CountUp value={e.ai.estimated_calories} active={isNewEntry} /> kcal burned</span>
                            </div>
                            <div className="ft-body" style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}>{e.ai.progression_suggestion}</div>
                          </div>
                        )}
                      </div>
                      </SwipeRow>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {tab === "charts" && (
          <div>
            <RevealOnScroll>
              <WeeklyConsistencyRow days={weeklyConsistency} lastWeekGoodCount={lastWeekGoodCount} />
            </RevealOnScroll>

            {(weeklyDeltaStats.proteinChangePct != null || weeklyDeltaStats.calorieChangePct != null) && (
              <div className="flex items-center gap-3 p-3 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)", flexWrap: "wrap" }}>
                <span className="ft-body" style={{ fontSize: 11, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.4, textTransform: "uppercase", flexShrink: 0 }}>vs last week</span>
                <div className="flex items-center gap-3 flex-wrap">
                  {weeklyDeltaStats.proteinChangePct != null && (
                    <div className="flex items-center gap-1">
                      <TrendArrow trend={weeklyDeltaStats.proteinChangePct > 0 ? "up" : weeklyDeltaStats.proteinChangePct < 0 ? "down" : "flat"} size={12} />
                      <span className="ft-mono" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Protein {weeklyDeltaStats.proteinChangePct > 0 ? "+" : ""}{weeklyDeltaStats.proteinChangePct}%</span>
                    </div>
                  )}
                  {weeklyDeltaStats.calorieChangePct != null && (
                    <div className="flex items-center gap-1">
                      <TrendArrow trend={weeklyDeltaStats.calorieChangePct > 0 ? "up" : weeklyDeltaStats.calorieChangePct < 0 ? "down" : "flat"} size={12} />
                      <span className="ft-mono" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Calories {weeklyDeltaStats.calorieChangePct > 0 ? "+" : ""}{weeklyDeltaStats.calorieChangePct}%</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {insights.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3 anim-insight-in" style={{ background: ins.bg, borderRadius: 16, animationDelay: `${i * 90}ms` }}>
                    <div style={{ marginTop: 1, flexShrink: 0 }}><ins.icon size={15} color={ins.color} /></div>
                    <span className="ft-body" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.4 }}>{ins.text}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mb-4">
              <Chip active={chartsSubTab === "nutrition"} onClick={() => setChartsSubTab("nutrition")} label="Nutrition" />
              <Chip active={chartsSubTab === "exercise"} onClick={() => setChartsSubTab("exercise")} label="Exercise" />
              <Chip active={chartsSubTab === "summary"} onClick={() => setChartsSubTab("summary")} label="Summary" />
            </div>

            {chartsSubTab === "nutrition" ? (
              <>
                <RevealOnScroll className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="flex items-center gap-1" style={{ background: C.bgBottom, borderRadius: 12, padding: 3, marginBottom: 12 }}>
                    {NUTRITION_CHART_METRICS.map((m) => (
                      <button key={m.key} onClick={() => setNutritionChartMetric(m.key)} className="flex-1 ft-body"
                        style={{
                          padding: "7px 0", borderRadius: 12, border: "none",
                          background: nutritionChartMetric === m.key ? C.card : "transparent",
                          color: nutritionChartMetric === m.key ? m.color : C.inkSoft,
                          fontSize: 12.5, fontWeight: 700,
                          boxShadow: nutritionChartMetric === m.key ? "0 1px 4px rgba(20,20,20,0.08)" : "none",
                          transition: "background .25s ease, color .25s ease, box-shadow .25s ease",
                        }}>{m.label}</button>
                    ))}
                  </div>
                  {(() => {
                    const active = NUTRITION_CHART_METRICS.find((m) => m.key === nutritionChartMetric);
                    return (
                      <ResponsiveContainer width="100%" height={150}>
                        <BarChart data={last14}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                          <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }}
                            formatter={(value) => [`${Math.round(value)}${active.unit}`, active.label]} />
                          <Bar dataKey={active.key} fill={active.color} radius={[3, 3, 0, 0]} isAnimationActive={!chartsSettled} animationDuration={600} animationEasing="ease-out" />
                        </BarChart>
                      </ResponsiveContainer>
                    );
                  })()}
                </RevealOnScroll>
                <RevealOnScroll className="p-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Weight</span>
                    {goals.targetWeight > 0 && <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>Goal: {goals.targetWeight}</span>}
                  </div>
                  {weightSeries.length === 0 ? <EmptyState text="Log a weight entry in Profile to see your trend." compact /> : (
                    <>
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={weightSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} domain={["dataMin - 2", "dataMax + 2"]} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                          {goals.targetWeight > 0 && (
                            <ReferenceLine y={goals.targetWeight} stroke={C.green} strokeOpacity={chartsSettled ? 1 : 0} strokeDasharray="4 4" strokeWidth={1.5}
                              style={{ transition: "stroke-opacity .5s ease" }}
                              label={{ value: "Goal", position: "insideTopRight", fill: C.green, fontSize: 12, style: { opacity: chartsSettled ? 1 : 0, transition: "opacity .5s ease" } }} />
                          )}
                          <Line type="monotone" dataKey="weight" stroke={C.ink} strokeWidth={2} dot={makeExpandingLastDot(weightSeries.length, chartsSettled, C.ink)} isAnimationActive={!chartsSettled} animationDuration={700} animationEasing="ease-out" />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                        {!weightPace ? (
                          <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Log at least 2 weigh-ins to see a pace projection.</span>
                        ) : !goals.targetWeight ? (
                          <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Currently {weightPace.paceKgPerWeek > 0 ? "gaining" : weightPace.paceKgPerWeek < 0 ? "losing" : "holding steady at"} {Math.abs(weightPace.paceKgPerWeek).toFixed(2)}/week. Set a goal weight in Profile to see a projection.</span>
                        ) : !weightProjection ? (
                          <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Weight has been stable — no clear pace to project from yet.</span>
                        ) : weightProjection.onTrack ? (
                          <span className="ft-body" style={{ fontSize: 12.5, color: C.green, fontWeight: 600 }}>On pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) to reach your goal in ~{weightProjection.weeks} weeks.</span>
                        ) : (
                          <span className="ft-body" style={{ fontSize: 12.5, color: C.pink, fontWeight: 600 }}>Current pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) is moving away from your goal.</span>
                        )}
                      </div>
                    </>
                  )}
                </RevealOnScroll>

                <div className="p-4 mt-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Micronutrients today</div>
                  {todayLogs.length === 0 ? <EmptyState text="Log a meal to see today's micronutrient breakdown." compact /> : (
                    <div className="flex flex-col gap-2.5">
                      {microSummary.map((m) => (
                        <div key={m.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="ft-body" style={{ fontSize: 12, color: C.ink, fontWeight: 500 }}>{m.label}</span>
                            <span className="ft-mono" style={{ fontSize: 12.5, color: C.inkSoft }}>{m.value}{m.unit}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: C.track, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${clamp(m.pct, 0, 100)}%`, background: m.capIsLimit && m.pct > 100 ? C.pink : m.color, borderRadius: 3, transition: "width .4s ease" }} />
                          </div>
                        </div>
                      ))}
                      <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>Calcium, iron, B12, vitamin D & potassium are estimated from the AI's per-meal %DV values.</div>
                    </div>
                  )}
                </div>
              </>
            ) : chartsSubTab === "exercise" ? (
              <>
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Training volume (kg/day)</div>
                  {exerciseLogs.length === 0 ? <EmptyState text="Log a workout to see your volume trend." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={last14}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                        <Bar dataKey="volume" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={!chartsSettled} animationDuration={600} animationEasing="ease-out" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
                <div className="p-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Estimated calories burned</div>
                  {exerciseLogs.length === 0 ? <EmptyState text="Get AI feedback on a workout to estimate calories burned." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={last14}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                        <Bar dataKey="burned" fill={C.pink} radius={[3, 3, 0, 0]} isAnimationActive={!chartsSettled} animationDuration={600} animationEasing="ease-out" />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex gap-2 mb-4">
                  <Chip active={chartsPeriod === "week"} onClick={() => setChartsPeriod("week")} label="This week" />
                  <Chip active={chartsPeriod === "month"} onClick={() => setChartsPeriod("month")} label="This month" />
                </div>

                {chartsPeriod === "week" ? (
                  <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <BarChart3 size={15} color={C.blue} />
                      </div>
                      <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Weekly AI Review</span>
                    </div>
                    {weeklyReviewLoading ? (
                      <div className="flex flex-col gap-2 py-1">
                        <SkeletonBlock width="95%" height={11} />
                        <SkeletonBlock width="70%" height={11} />
                        <SkeletonBlock width="60%" height={30} radius={12} style={{ marginTop: 4 }} />
                      </div>
                    ) : weeklyReview && weeklyReview.weekStart === currentWeekStart ? (
                      <>
                        <div className="ft-body mb-2.5" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>{weeklyReview.summary}</div>
                        {weeklyReview.focusNextWeek && (
                          <div className="flex items-start gap-2 p-2.5 mb-2" style={{ background: C.orangeTint, borderRadius: 12 }}>
                            <Sparkles size={13} color={C.orange} style={{ flexShrink: 0, marginTop: 1 }} />
                            <span className="ft-body" style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}><span style={{ fontWeight: 700 }}>Focus next week: </span>{weeklyReview.focusNextWeek}</span>
                          </div>
                        )}
                        <button onClick={generateWeeklyReview} className="ft-body" style={{ fontSize: 12.5, color: C.blue, fontWeight: 600 }}>Refresh</button>
                      </>
                    ) : (
                      <>
                        <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.4 }}>
                          Reviews auto-generate every 7 days once there's enough logged data — or generate one now.
                        </div>
                        <button onClick={generateWeeklyReview} className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full ft-body" style={{ background: C.ink, color: C.onInk, fontSize: 12, fontWeight: 600 }}>
                          <Sparkles size={13} />Generate this week's review
                        </button>
                      </>
                    )}
                    {weeklyReviewError && <div className="ft-body mt-2" style={{ fontSize: 12.5, color: C.pink }}>{weeklyReviewError}</div>}
                  </div>
                ) : (
                  <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.purpleTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <CalendarDays size={15} color={C.purple} />
                      </div>
                      <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Monthly AI Review</span>
                    </div>
                    {monthlyReviewLoading ? (
                      <div className="flex flex-col gap-2 py-1">
                        <SkeletonBlock width="95%" height={11} />
                        <SkeletonBlock width="70%" height={11} />
                        <SkeletonBlock width="60%" height={30} radius={12} style={{ marginTop: 4 }} />
                      </div>
                    ) : monthlyReview && monthlyReview.monthStart === currentMonthStart ? (
                      <>
                        <div className="ft-body mb-2.5" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>{monthlyReview.summary}</div>
                        {monthlyReview.focusNextMonth && (
                          <div className="flex items-start gap-2 p-2.5 mb-2" style={{ background: C.purpleTint, borderRadius: 12 }}>
                            <Sparkles size={13} color={C.purple} style={{ flexShrink: 0, marginTop: 1 }} />
                            <span className="ft-body" style={{ fontSize: 12, color: C.ink, lineHeight: 1.4 }}><span style={{ fontWeight: 700 }}>Focus next month: </span>{monthlyReview.focusNextMonth}</span>
                          </div>
                        )}
                        <button onClick={generateMonthlyReview} className="ft-body" style={{ fontSize: 12.5, color: C.purple, fontWeight: 600 }}>Refresh</button>
                      </>
                    ) : (
                      <>
                        <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.4 }}>
                          Reviews auto-generate every 30 days once there's enough logged data — or generate one now.
                        </div>
                        <button onClick={generateMonthlyReview} className="flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-full ft-body" style={{ background: C.ink, color: C.onInk, fontSize: 12, fontWeight: 600 }}>
                          <Sparkles size={13} />Generate this month's review
                        </button>
                      </>
                    )}
                    {monthlyReviewError && <div className="ft-body mt-2" style={{ fontSize: 12.5, color: C.pink }}>{monthlyReviewError}</div>}
                  </div>
                )}
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Avg calories/day</span>
                    <TrendArrow trend={periodSummary.calorieTrend} />
                  </div>
                  <div className="ft-display" style={{ fontSize: 30, fontWeight: 700, color: C.ink }}>{periodSummary.avgCalories}<span className="ft-body" style={{ fontSize: 13, color: C.inkSoft, fontWeight: 500 }}> / {goals.calories} kcal</span></div>
                  <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft, marginTop: 2 }}>{periodSummary.daysLogged} of {chartsPeriod === "week" ? 7 : 30} days logged</div>
                </div>
                <div className="flex gap-2.5 mb-4">
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 16 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>Protein</span><TrendArrow trend={periodSummary.proteinTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.purple }}>{periodSummary.avgProtein}g</div>
                  </div>
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 16 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>Carbs</span><TrendArrow trend={periodSummary.carbsTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.tan }}>{periodSummary.avgCarbs}g</div>
                  </div>
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 16 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>Fat</span><TrendArrow trend={periodSummary.fatTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.pink }}>{periodSummary.avgFat}g</div>
                  </div>
                </div>
                <div className="flex gap-2.5 mb-4">
                  <div className="flex-1 flex items-center gap-2.5 p-3.5" style={{ background: C.card, borderRadius: 16 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Flame size={16} color={C.pink} className={streak > 0 ? "anim-flame-flicker" : ""} />
                    </div>
                    <div><div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{streak}</div><div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>current streak</div></div>
                  </div>
                  <div className="flex-1 flex items-center gap-2.5 p-3.5" style={{ background: C.card, borderRadius: 16 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 12, background: C.tanTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trophy size={16} color={C.tan} /></div>
                    <div><div className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{bestStreak}</div><div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>best streak</div></div>
                  </div>
                </div>

                <div className="p-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Weekly goal achievement</div>
                  <div className="mb-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="ft-body" style={{ fontSize: 12, color: C.ink }}>Calories goal achieved</span>
                      <span className="ft-mono" style={{ fontSize: 12, fontWeight: 700, color: C.orange }}>{weeklyAchievement.caloriesAchieved}/{weeklyAchievement.totalDays} days</span>
                    </div>
                    <AchievementBar perDay={weeklyAchievement.perDay} hitKey="calHit" />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="ft-body" style={{ fontSize: 12, color: C.ink }}>Protein goal achieved</span>
                      <span className="ft-mono" style={{ fontSize: 12, fontWeight: 700, color: C.purple }}>{weeklyAchievement.proteinAchieved}/{weeklyAchievement.totalDays} days</span>
                    </div>
                    <AchievementBar perDay={weeklyAchievement.perDay} hitKey="proteinHit" />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

       {tab === "profile" && (
  <ProfilePanel
    goals={goals}
    onSaveGoals={persistGoals}
    weights={weights}
    onDeleteWeight={deleteWeightEntry}
    darkMode={darkMode}
    setDarkMode={setDarkMode}
    splits={splits}
    onSaveSplits={persistSplits}
  />
)}
        </div>

      </div>

      {/* Dimmed, blurred backdrop behind the fan — also closes it on tap.
          Always mounted (not conditionally added) so it fades in/out smoothly
          instead of popping, mirroring the fan buttons' own transition. */}
      <div
        onClick={() => setFabOpen(false)}
        className="absolute inset-0"
        style={{
          zIndex: 35,
          background: "rgba(10,10,14,0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          opacity: fabOpen ? 1 : 0,
          pointerEvents: fabOpen ? "auto" : "none",
          transition: "opacity .3s ease",
        }}
      />

      <div className="absolute left-4 right-4 flex items-center" style={{
        background: C.card, borderRadius: 30, height: 64,
        bottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        boxShadow: "0 10px 30px rgba(20,20,20,0.16), 0 2px 8px rgba(20,20,20,0.07)",
      }}>
        <NavBtn active={tab === "home"} onClick={() => animateTabChange("home")} icon={Home} label="Home" />
        <NavBtn active={tab === "logs"} onClick={() => animateTabChange("logs")} icon={ClipboardList} label="Logs" />
        <NavBtn active={tab === "charts"} onClick={() => animateTabChange("charts")} icon={BarChart3} label="Insights" />
        <NavBtn active={tab === "profile"} onClick={() => animateTabChange("profile")} icon={User} label="Profile" />
      </div>

      {/* Fan-out quick actions — Meal / Exercise, stacked upward (Meal
          closest to the FAB, Exercise above it) rather than side by side.
          Right-aligned to match the FAB's new position above Profile.
          Always mounted so the close animation can reverse smoothly instead
          of just vanishing; each button's own opacity/transform is driven by
          fabOpen, with a slight stagger between the two. */}
      <div className="absolute flex flex-col-reverse items-end gap-3" style={{
        right: "calc(12.5% - 14px)",
        bottom: "calc(156px + env(safe-area-inset-bottom, 0px))",
        pointerEvents: fabOpen ? "auto" : "none",
        zIndex: 45,
      }}>
        {[
          { key: "meal", icon: Utensils, label: "Meal", color: C.orange, bg: C.orangeTint, onSelect: () => openAdd("meal", "photo") },
          { key: "exercise", icon: Dumbbell, label: "Exercise", color: C.blue, bg: C.blueTint, onSelect: () => openAdd("exercise", "photo") },
        ].map((opt, i) => (
          <button
            key={opt.key}
            onClick={() => { opt.onSelect(); setFabOpen(false); }}
            className="flex items-center gap-2 ft-body fab-option"
            style={{
              transform: fabOpen ? "translateY(0) scale(1)" : "translateY(18px) scale(0.6)",
              opacity: fabOpen ? 1 : 0,
              transitionDelay: fabOpen ? `${i * 70}ms` : `${(1 - i) * 40}ms`,
              background: C.card, borderRadius: 999, padding: "10px 18px 10px 8px",
              boxShadow: "0 8px 20px rgba(20,20,20,0.18)",
              border: "none", whiteSpace: "nowrap",
            }}>
            <span style={{ width: 32, height: 32, borderRadius: "50%", background: opt.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <opt.icon size={15} color={opt.color} />
            </span>
            <span className="ft-body" style={{ fontSize: 13.5, fontWeight: 600, color: C.ink }}>{opt.label}</span>
          </button>
        ))}
      </div>

      <button
        onClick={() => setFabOpen((o) => !o)}
        onPointerDown={(e) => { setFabPressed(true); addRippleEffect(e); }}
        onPointerUp={() => setFabPressed(false)}
        onPointerLeave={() => setFabPressed(false)}
        onPointerCancel={() => setFabPressed(false)}
        className={`absolute flex items-center justify-center fab-pill${!fabOpen && !fabPressed ? " fab-breathe" : ""}`}
        style={{
          right: "calc(12.5% - 14px)",
          overflow: "hidden",
          transform: fabOpen
            ? "rotate(45deg)"
            : fabPressed
              ? "translateY(-8px) scale(1.1)"
              : "none",
          bottom: "calc(90px + env(safe-area-inset-bottom, 0px))",
          width: 52, height: 52, borderRadius: "50%",
          background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})`,
          boxShadow: fabPressed || fabOpen
            ? "0 16px 30px rgba(238,108,55,0.48), 0 4px 12px rgba(238,108,55,0.36)"
            : "0 8px 18px rgba(238,108,55,0.4), 0 2px 6px rgba(238,108,55,0.3)",
          border: "none", zIndex: 46,
        }}>
        <Plus size={24} color="#fff" strokeWidth={2.4} />
      </button>


      {showAdd && (
        <AddLogSheet
          initialLogType={addLogType} initialMode={addMode} goals={goals} todayTotals={todayTotals} todayLogs={todayLogs} exerciseLogs={exerciseLogs}
          favorites={favorites} recentMeals={recentMeals} onToggleFavorite={toggleFavorite} splits={splits}
          editingEntry={editingEntry}
          onClose={() => { setShowAdd(false); setEditingEntry(null); }}
          onSaveMeal={async (entry) => {
            const exists = logs.some((l) => l.id === entry.id);
            const next = exists ? logs.map((l) => (l.id === entry.id ? entry : l)) : [entry, ...logs];
            await persistLogs(next);
            haptic("success");
            if (!exists) { firePulse("meal"); setJustAddedId(entry.id); setTimeout(() => setJustAddedId(null), 1200); }
            setShowAdd(false); setEditingEntry(null);
          }}
          onSaveExercise={async (entry) => {
            const exists = exerciseLogs.some((x) => x.id === entry.id);
            const next = exists ? exerciseLogs.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...exerciseLogs];
            await persistExercise(next);
            haptic("success");
            if (!exists) {
              firePulse("workout");
              setJustAddedId(entry.id);
              setTimeout(() => setJustAddedId(null), 1200);
              const overload = computeProgressiveOverload(entry, exerciseLogs);
              if (overload && overload.isPR) {
                fireCelebration({ icon: Award, color: C.tan, bg: C.tanTint, text: `🏋️ Personal Record — ${entry.name}!` });
              }
            }
            setShowAdd(false); setEditingEntry(null);
          }}
        />
      )}
      {showSleep && (
        <SleepTrackerScreen
          sleepLogs={sleepLogs}
          goals={goals}
          onSave={(bedtime, wakeTime) => addSleep(bedtime, wakeTime)}
          onClose={() => setShowSleep(false)}
        />
      )}
      {showWeight && (
        <WeightTrackerScreen
          weights={weights}
          weightSeries={weightSeries}
          goalWeight={goals.targetWeight}
          weightPace={weightPace}
          weightProjection={weightProjection}
          onAdd={(w) => addWeightEntry(w)}
          onDelete={(id) => deleteWeightEntry(id)}
          onClose={() => setShowWeight(false)}
        />
      )}
      {showScore && (
        <NutritionScoreScreen
          nutritionScore={nutritionScore}
          yesterdayScore={yesterdayNutritionScore}
          fireCelebration={fireCelebration}
          onClose={() => setShowScore(false)}
        />
      )}
    </div>
  );
}

// ---------- Add Log Sheet (Meal or Exercise) ----------
function AddLogSheet({ initialLogType, initialMode, goals, todayTotals, todayLogs, exerciseLogs, favorites, recentMeals, onToggleFavorite, splits, editingEntry, onClose, onSaveMeal, onSaveExercise }) {
  const [logType, setLogType] = useState(initialLogType);
  const isEditing = !!editingEntry;

  // Closing is driven locally so the sheet can slide back down / the
  // backdrop can fade out before the parent actually unmounts it, instead of
  // the whole thing just vanishing.
  const [closing, setClosing] = useState(false);
  function requestClose() {
    setClosing(true);
    setTimeout(onClose, 220);
  }

  return (
    <div className={`absolute inset-0 flex flex-col justify-end ${closing ? "anim-sheet-backdrop-out" : "anim-sheet-backdrop-in"}`} style={{ background: "rgba(21,23,27,0.4)", zIndex: 50 }} onClick={requestClose}>
      <div className={`flex flex-col ${closing ? "anim-sheet-slide-out" : "anim-sheet-slide-in"}`} style={{ background: C.bgBottom, borderRadius: "24px 24px 0 0", maxHeight: "90%", boxShadow: "0 -8px 30px rgba(0,0,0,0.2)", overflowX: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{isEditing ? (logType === "meal" ? "Edit meal" : "Edit workout") : "Add a log"}</span>
          <button onClick={requestClose} style={{ width: 30, height: 30, borderRadius: "50%", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} color={C.ink} /></button>
        </div>
        {!isEditing && (
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
        )}
        <div className="overflow-y-auto px-5 pb-6">
          {logType === "meal"
            ? <MealForm initialMode={initialMode} goals={goals} todayTotals={todayTotals} todayLogs={todayLogs} onSave={onSaveMeal}
                favorites={favorites} recentMeals={recentMeals} onToggleFavorite={onToggleFavorite}
                editingEntry={isEditing && editingEntry.type === "meal" ? editingEntry.entry : null} />
            : <ExerciseForm exerciseLogs={exerciseLogs} onSave={onSaveExercise} splits={splits}
                editingEntry={isEditing && editingEntry.type === "exercise" ? editingEntry.entry : null} />}
        </div>
      </div>
    </div>
  );
}

const EMPTY_MEAL = { food_name: "", estimated_portion: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, micronutrients: [], confidence: "manual", estimate_basis: "", portion_verdict: null, portion_change_percent: 0, portion_guidance: "", items: [] };

function MealForm({ initialMode, goals, todayTotals, todayLogs, onSave, favorites, recentMeals, onToggleFavorite, editingEntry }) {
  const [mode, setMode] = useState(initialMode === "manual" ? "text" : initialMode);
  const [imagePreview, setImagePreview] = useState(null);
  const [imagePreview2, setImagePreview2] = useState(null); // optional second angle — never required
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => {
    if (editingEntry) return { ...editingEntry };
    return initialMode === "manual" ? { ...EMPTY_MEAL } : null;
  });
  const [photoInputId] = useState(() => "meal-photo-" + uid());
  const [galleryInputId] = useState(() => "meal-gallery-" + uid());
  const [photoInputId2] = useState(() => "meal-photo2-" + uid());
  const [galleryInputId2] = useState(() => "meal-gallery2-" + uid());
  const [compressing, setCompressing] = useState(false);
  // A tiny (thumbnail-sized) copy of the photo, saved onto the log entry itself
  // so meal cards can show a small preview — kept separate from imagePreview
  // (which stays large enough for the AI to actually analyze).
  const [photoThumb, setPhotoThumb] = useState(editingEntry && editingEntry.photo_thumb ? editingEntry.photo_thumb : null);

  // ---------- Barcode / packaged-food scanning ----------
  // A parallel path to AI photo/text analysis: matches a barcode to an exact
  // label in OpenFoodFacts instead of asking Gemini to guess. Kept fully
  // separate from analyze()/callGemini — no AI call happens on this path.
  const [barcodeInput, setBarcodeInput] = useState("");
  const [scanningBarcode, setScanningBarcode] = useState(false);
  const [barcodeError, setBarcodeError] = useState(null);
  const [scannedProduct, setScannedProduct] = useState(null); // { name, brand, servingGrams, per100g }
  const [barcodeQuantity, setBarcodeQuantity] = useState("100");

  async function runBarcodeLookup(code) {
    setBarcodeError(null); setScanningBarcode(true); setScannedProduct(null);
    try {
      const product = await lookupBarcodeProduct(code);
      setScannedProduct(product);
      setBarcodeQuantity(String(product.servingGrams || 100));
    } catch (e) {
      setBarcodeError(e && e.message ? e.message : "Couldn't look up that barcode.");
    } finally {
      setScanningBarcode(false);
    }
  }

  async function scanBarcodeNative() {
    setBarcodeError(null);
    if (!window.Capacitor?.isNativePlatform?.()) {
      setBarcodeError("Camera barcode scanning only works in the installed app, not in a mobile browser — that's why no permission prompt appears in your phone's app settings. You can still type the barcode number in below.");
      return;
    }
    try {
      const { camera } = await BarcodeScanner.requestPermissions();
      if (camera !== "granted" && camera !== "limited") {
        setBarcodeError("Camera permission is needed to scan a barcode. You can still type the number in below.");
        return;
      }
      const { barcodes } = await BarcodeScanner.scan();
      const value = barcodes && barcodes[0] && barcodes[0].rawValue;
      if (!value) return; // user cancelled the scan
      setBarcodeInput(value);
      await runBarcodeLookup(value);
    } catch (e) {
      setBarcodeError(e && e.message ? e.message : "Barcode scan failed — try typing the number instead.");
    }
  }

  // Turns the scanned product's per-100g label data + the quantity the user
  // actually ate into a normal pending-meal object, so it flows through the
  // exact same review/edit/save screen as an AI-analyzed meal.
  function applyBarcodeQuantity() {
    if (!scannedProduct) return;
    const grams = num(barcodeQuantity);
    if (grams <= 0) { setBarcodeError("Enter how many grams you're having."); return; }
    const scale = grams / 100;
    const p100 = scannedProduct.per100g;
    setPending({
      ...EMPTY_MEAL,
      food_name: scannedProduct.brand ? `${scannedProduct.name} (${scannedProduct.brand})` : scannedProduct.name,
      estimated_portion: `${grams}g`,
      calories: Math.round(p100.calories * scale),
      protein_g: Math.round(p100.protein_g * scale * 10) / 10,
      carbs_g: Math.round(p100.carbs_g * scale * 10) / 10,
      fat_g: Math.round(p100.fat_g * scale * 10) / 10,
      fiber_g: Math.round(p100.fiber_g * scale * 10) / 10,
      sugar_g: Math.round(p100.sugar_g * scale * 10) / 10,
      sodium_mg: Math.round(p100.sodium_mg * scale),
      confidence: "high",
      estimate_basis: `Matched via barcode to a packaged-food label (OpenFoodFacts) scaled to ${grams}g — this is the manufacturer's declared nutrition, not an AI estimate.`,
      items: [],
    });
    setLastCalculatedPortion(`${grams}g`);
    setLastCalculatedItems([]);
    setAiEstimate(null); // exact label data — not an AI guess, so correction-learning doesn't apply here
    setShowFullDetails(true);
  }

  async function handleImagePick(e, slot = 1) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null); setPending(null); setCompressing(true);
    try {
      const { b64, mediaType } = await compressImageFile(file);
      if (slot === 2) setImagePreview2({ b64, mediaType }); else setImagePreview({ b64, mediaType });
    } catch {
      // Compression failed (unsupported format, canvas error, etc.) — fall back
      // to sending the original file uncompressed rather than blocking the log.
      const b64 = await fileToBase64(file);
      if (slot === 2) setImagePreview2({ b64, mediaType: file.type || "image/jpeg" }); else setImagePreview({ b64, mediaType: file.type || "image/jpeg" });
    } finally {
      setCompressing(false);
    }
    if (slot === 2) return; // only the primary photo gets a card thumbnail
    // Best-effort tiny thumbnail for the meal card — failure here shouldn't
    // block logging, so it's just skipped if it doesn't work out.
    try {
      const thumb = await compressImageFile(file, { maxDimension: 96, quality: 0.55 });
      setPhotoThumb(`data:${thumb.mediaType};base64,${thumb.b64}`);
    } catch { /* thumbnail is optional — ignore failures */ }
  }

  async function analyze(overrideDescription) {
    const descriptionToUse = overrideDescription != null ? overrideDescription : description;
    setError(null); setPending(null); setJustAnalyzed(false);
    if (mode === "photo" && !imagePreview) { setError("Add a photo first."); return; }
    if (mode === "text" && descriptionToUse.trim().length < 2) { setError("Describe what you ate first."); return; }
    setAnalyzing(true);
    try {
      const foodGuess = mode === "text" ? descriptionToUse : "";
      const portionMemoryNote = buildPortionMemoryNote(foodGuess);
      const photoCount = mode === "photo" ? (imagePreview2 ? 2 : 1) : 0;
      const promptText = buildMealPrompt({ mode, description: descriptionToUse, goals, todayTotals, todayLogs, portionMemoryNote, photoCount });
      const photoBlocks = [imagePreview, imagePreview2].filter(Boolean).map((img) => ({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.b64 } }));
      const blocks = mode === "photo"
        ? [...photoBlocks, { type: "text", text: promptText }]
        : [{ type: "text", text: promptText }];
      const raw = await callGemini(blocks);
      const parsed = parseJSON(raw);
      const estimatedPortion = parsed.estimated_portion || "";
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((it) => ({
            food_name: it.food_name || "Item", estimated_portion: it.estimated_portion || "",
            calories: num(it.calories), protein_g: num(it.protein_g), carbs_g: num(it.carbs_g), fat_g: num(it.fat_g),
          }))
        : [];
      setPending({
        food_name: parsed.food_name || (mode === "text" ? descriptionToUse : "Logged meal"),
        estimated_portion: estimatedPortion,
        calories: num(parsed.calories), protein_g: num(parsed.protein_g), carbs_g: num(parsed.carbs_g), fat_g: num(parsed.fat_g),
        fiber_g: num(parsed.fiber_g), sugar_g: num(parsed.sugar_g), sodium_mg: num(parsed.sodium_mg),
        micronutrients: Array.isArray(parsed.micronutrients) ? parsed.micronutrients : [],
        confidence: parsed.confidence || "medium",
        estimate_basis: parsed.estimate_basis || "",
        portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent),
        portion_guidance: parsed.portion_guidance || "",
        items,
      });
      setLastCalculatedPortion(estimatedPortion);
      setLastCalculatedItems(items);
      setAiEstimate({ portion: estimatedPortion, calories: num(parsed.calories) });
      setQuickFeedbackGiven(null);
      if (items.length > 0) setShowItemBreakdown(true);
      setJustAnalyzed(true);
      setShowFullDetails(false);
      setTimeout(() => setJustAnalyzed(false), 2200);
    } catch (e) {
      setError((e && e.message ? e.message : "Couldn't analyze that meal") + " — enter it manually below.");
      setPending({ ...EMPTY_MEAL, food_name: mode === "text" ? descriptionToUse : "Logged meal" });
      setLastCalculatedPortion("");
      setLastCalculatedItems([]);
      setAiEstimate(null);
      setJustAnalyzed(false);
      setShowFullDetails(true);
    } finally { setAnalyzing(false); }
  }

  // ---------- Natural voice logging ----------
  // The browser's Web Speech API (window.SpeechRecognition) is NOT implemented
  // inside Android's WebView, so it silently fails when running as the actual
  // installed app — only works when tested in Chrome directly. Inside the
  // installed app we use the native @capacitor-community/speech-recognition
  // plugin instead (wraps Android's real SpeechRecognizer); the browser API is
  // kept as a fallback for testing in a regular mobile browser. Either path
  // feeds the transcript straight into the same Gemini meal-analysis call used
  // for typed text — so "2 rotis, one bowl dal, 100g paneer" spoken aloud is
  // understood and logged as one meal without manual typing or splitting.
  const [listening, setListening] = useState(false);
  // Briefly true right after a transcript is successfully captured — the mic
  // button contracts into a checkmark for a beat before AI analysis kicks
  // off automatically, so "finished listening" reads as a confirmed step
  // rather than the UI just jumping straight into a loading state.
  const [voiceJustFinished, setVoiceJustFinished] = useState(false);
  const recognitionRef = useRef(null);
  const isNative = typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();
  const speechSupported = isNative || (typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition));

  async function toggleVoiceInput() {
    if (isNative) return toggleNativeVoiceInput();
    return toggleBrowserVoiceInput();
  }

  async function toggleNativeVoiceInput() {
    if (listening) {
      try { await SpeechRecognition.stop(); } catch { /* already stopped */ }
      return;
    }
    setError(null);
    try {
      const { available } = await SpeechRecognition.available();
      if (!available) {
        setError("Voice recognition isn't available on this device (no speech-recognition service installed). Try typing instead.");
        return;
      }
    } catch { /* if the check itself fails, fall through and let start() surface the real error */ }
    try {
      const { speechRecognition } = await SpeechRecognition.checkPermissions();
      let granted = speechRecognition === "granted";
      if (!granted) {
        const req = await SpeechRecognition.requestPermissions();
        granted = req.speechRecognition === "granted";
      }
      if (!granted) {
        setError("Microphone permission is needed to use voice input — allow it for Nourish in your phone's app settings, then try again.");
        return;
      }
    } catch {
      setError("Couldn't access the microphone. Try again or type instead.");
      return;
    }
    // Pulls the first usable transcript out of whatever shape the plugin hands
    // back — different Android versions/OEM speech services have been known to
    // return either {matches:[...]}, a bare array, or a single {value} object.
    const extractMatch = (data) => {
      if (!data) return "";
      if (Array.isArray(data)) return data[0] || "";
      if (Array.isArray(data.matches)) return data.matches[0] || "";
      if (typeof data.value === "string") return data.value;
      return "";
    };
    let liveTranscript = "";
    const listener = await SpeechRecognition.addListener("partialResults", (data) => {
      const match = extractMatch(data);
      if (match) { liveTranscript = match; setDescription(match); }
    });
    setListening(true);
    try {
      // popup:true shows Android's native "Speak now" listening UI — headless
      // (popup:false) mode has been unreliable on several OEM keyboards/speech
      // services, silently returning no matches with no error at all.
      const result = await SpeechRecognition.start({
        language: navigator.language || "en-US",
        maxResults: 1,
        prompt: "Speak your meal",
        partialResults: true,
        popup: true,
      });
      const finalMatch = extractMatch(result) || liveTranscript;
      setListening(false);
      listener.remove();
      const transcript = (finalMatch || "").trim();
      if (transcript.length >= 2) {
        setDescription(transcript);
        setVoiceJustFinished(true);
        setTimeout(() => { setVoiceJustFinished(false); analyze(transcript); }, 500);
      }
      else setError("Didn't catch any words — try again, speak right after tapping, or type instead.");
    } catch (e) {
      setListening(false);
      listener.remove();
      setError("Couldn't hear that — try again or type instead.");
    }
  }

  function toggleBrowserVoiceInput() {
    if (listening) { recognitionRef.current && recognitionRef.current.stop(); return; }
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) { setError("Voice input isn't supported in this browser."); return; }
    setError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = (navigator.language || "en-US");
    recognition.continuous = false;
    recognition.interimResults = true;
    let finalTranscript = "";
    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += chunk;
        else interim += chunk;
      }
      setDescription((finalTranscript + interim).trim());
    };
    recognition.onerror = (event) => {
      setListening(false);
      if (event.error === "no-speech" || event.error === "aborted") return;
      const messages = {
        "not-allowed": "Microphone permission is blocked for this site — tap the lock/info icon next to the address bar, allow microphone access, then try again.",
        "permission-denied": "Microphone permission is blocked for this site — tap the lock/info icon next to the address bar, allow microphone access, then try again.",
        "audio-capture": "No microphone found on this device — try again or type instead.",
        "network": "Voice recognition needs an internet connection to work — try again once you're online, or type instead.",
        "service-not-allowed": "Voice recognition is blocked by the browser right now — try again or type instead.",
      };
      setError(messages[event.error] || "Couldn't hear that — try again or type instead.");
    };
    recognition.onend = () => {
      setListening(false);
      const transcript = finalTranscript.trim();
      if (transcript.length >= 2) {
        setVoiceJustFinished(true);
        setTimeout(() => { setVoiceJustFinished(false); analyze(transcript); }, 500);
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }
  useEffect(() => () => {
    recognitionRef.current && recognitionRef.current.stop();
    if (isNative) { SpeechRecognition.stop().catch(() => {}); SpeechRecognition.removeAllListeners().catch(() => {}); }
  }, []);

  async function getPortionAdvice() {
    if (!pending || !pending.food_name || !pending.calories) { setError("Fill in the meal name and calories first."); return; }
    setError(null); setAdvising(true);
    try {
      const promptText = buildPortionAdvicePrompt({ pending, goals, todayTotals, todayLogs });
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      setPending((p) => ({ ...p, portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent), portion_guidance: parsed.portion_guidance || "" }));
    } catch (e) {
      setError(e && e.message ? e.message : "Couldn't get portion guidance.");
    } finally { setAdvising(false); }
  }

  // Tracks the portion text the current nutrition numbers actually correspond
  // to, so we know when the user has edited it (e.g. "1 cup rice" -> "1/2 cup
  // rice") and the numbers below are now stale.
  const [lastCalculatedPortion, setLastCalculatedPortion] = useState(editingEntry ? (editingEntry.estimated_portion || "") : "");
  // Snapshot of pending.items right after analyze()/recalculateFromPortion() —
  // compared against the live items to catch edits to an *individual* item's
  // portion (e.g. changing "30g" to "40g" in the item breakdown) even when
  // the top-level estimated_portion field itself hasn't been touched.
  const [lastCalculatedItems, setLastCalculatedItems] = useState(editingEntry ? (editingEntry.items || []) : []);
  const [recalculating, setRecalculating] = useState(false);
  const portionIsStale = !!pending && pending.estimated_portion !== lastCalculatedPortion;
  const itemsAreStale = !!pending && JSON.stringify(pending.items || []) !== JSON.stringify(lastCalculatedItems || []);
  const nutritionIsStale = portionIsStale || itemsAreStale;
  // The AI's original estimate for the current pending meal (portion + calories),
  // captured right after analyze()/recalculateFromPortion() — compared against
  // whatever the user actually saves so repeated corrections can be learned from.
  const [aiEstimate, setAiEstimate] = useState(null);
  const [showWhyEstimate, setShowWhyEstimate] = useState(false);
  const [showItemBreakdown, setShowItemBreakdown] = useState(false);
  const [quickFeedbackGiven, setQuickFeedbackGiven] = useState(null); // null | "up" | "down"
  // True for a brief window right after analyze() lands a fresh AI result —
  // drives the count-up/stagger reveal animations on the results card.
  // Left false for manual entry, barcode matches, and when reopening an
  // existing logged meal to edit, since those aren't a "fresh" AI moment.
  const [justAnalyzed, setJustAnalyzed] = useState(false);
  // Controls whether the results screen shows the "Analysis Complete"
  // summary (screen matching the reference design's overview) or the full
  // editable breakdown. Starts true (skip straight to the full form) when
  // editing an existing saved entry — the summary is only for a fresh AI
  // result to react to, not something to re-show every time an old meal is
  // reopened.
  const [showFullDetails, setShowFullDetails] = useState(!!editingEntry);

  function giveQuickFeedback(isAccurate) {
    if (!aiEstimate || !pending || !pending.food_name) return;
    recordQuickFeedback(pending.food_name, { aiPortion: aiEstimate.portion, aiCalories: aiEstimate.calories }, isAccurate);
    setQuickFeedbackGiven(isAccurate ? "up" : "down");
    haptic("light");
  }

  function updateField(key, value) { setPending((p) => ({ ...p, [key]: key === "food_name" || key === "estimated_portion" ? value : num(value) })); }
  function updateItemField(i, key, value) {
    setPending((p) => {
      const items = [...(p.items || [])];
      items[i] = { ...items[i], [key]: value };
      return { ...p, items };
    });
  }

  async function recalculateFromPortion() {
    if (!pending || !pending.food_name) { setError("Give the meal a name first."); return; }
    setError(null); setRecalculating(true);
    try {
      // If there are individual items, describe the meal item-by-item using
      // their (possibly just-edited) portions — otherwise an edit made only
      // in the item breakdown (not the top-level portion field) would be
      // silently ignored by the recalculation.
      const description2 = pending.items && pending.items.length > 0
        ? pending.items.map((it) => `${it.food_name}${it.estimated_portion ? ` (${it.estimated_portion})` : ""}`).join(", ")
        : `${pending.food_name}${pending.estimated_portion ? ` — portion: ${pending.estimated_portion}` : ""}`;
      const portionMemoryNote = buildPortionMemoryNote(pending.food_name);
      const promptText = buildMealPrompt({ mode: "text", description: description2, goals, todayTotals, todayLogs, portionMemoryNote });
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      const items = Array.isArray(parsed.items)
        ? parsed.items.map((it) => ({
            food_name: it.food_name || "Item", estimated_portion: it.estimated_portion || "",
            calories: num(it.calories), protein_g: num(it.protein_g), carbs_g: num(it.carbs_g), fat_g: num(it.fat_g),
          }))
        : [];
      setPending((p) => ({
        ...p,
        estimated_portion: parsed.estimated_portion || p.estimated_portion,
        calories: num(parsed.calories), protein_g: num(parsed.protein_g), carbs_g: num(parsed.carbs_g), fat_g: num(parsed.fat_g),
        fiber_g: num(parsed.fiber_g), sugar_g: num(parsed.sugar_g), sodium_mg: num(parsed.sodium_mg),
        micronutrients: Array.isArray(parsed.micronutrients) ? parsed.micronutrients : p.micronutrients,
        confidence: parsed.confidence || p.confidence,
        estimate_basis: parsed.estimate_basis || p.estimate_basis,
        portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent),
        portion_guidance: parsed.portion_guidance || "",
        items: items.length ? items : p.items,
      }));
      setLastCalculatedPortion(parsed.estimated_portion || pending.estimated_portion);
      setLastCalculatedItems(items.length ? items : pending.items);
      setAiEstimate({ portion: parsed.estimated_portion || pending.estimated_portion, calories: num(parsed.calories) });
      setQuickFeedbackGiven(null);
    } catch (e) {
      setError(e && e.message ? e.message : "Couldn't recalculate nutrition for that portion.");
    } finally { setRecalculating(false); }
  }

  async function save() {
    if (!pending || !pending.food_name) { setError("Give the meal a name."); return; }
    // Learn from any manual correction vs. the AI's own estimate before persisting
    // (skipped for fully-manual entries that had no AI baseline to compare to).
    if (aiEstimate) {
      recordPortionCorrection(pending.food_name, {
        aiPortion: aiEstimate.portion, userPortion: pending.estimated_portion,
        aiCalories: aiEstimate.calories, userCalories: pending.calories,
      });
    }
    await onSave({
      id: editingEntry ? editingEntry.id : uid(),
      date: editingEntry ? editingEntry.date : todayStr(),
      timestamp: editingEntry ? editingEntry.timestamp : Date.now(),
      source: editingEntry ? editingEntry.source : mode,
      ...pending,
      photo_thumb: photoThumb || (editingEntry ? editingEntry.photo_thumb : null) || null,
    });
  }

  function quickLog(meal) {
    onSave({
      id: uid(), date: todayStr(), timestamp: Date.now(), source: "quick",
      food_name: meal.food_name, estimated_portion: meal.estimated_portion || "",
      calories: num(meal.calories), protein_g: num(meal.protein_g), carbs_g: num(meal.carbs_g), fat_g: num(meal.fat_g),
      fiber_g: num(meal.fiber_g), sugar_g: num(meal.sugar_g), sodium_mg: num(meal.sodium_mg),
      micronutrients: Array.isArray(meal.micronutrients) ? meal.micronutrients : [],
      confidence: meal.confidence || "manual", estimate_basis: meal.estimate_basis || "",
      portion_verdict: meal.portion_verdict || null, portion_change_percent: num(meal.portion_change_percent),
      portion_guidance: meal.portion_guidance || "",
    });
  }

  const isFav = (name) => (favorites || []).some((f) => (f.food_name || "").trim().toLowerCase() === (name || "").trim().toLowerCase());

  const quickPicks = !editingEntry ? [
    ...(favorites || []),
    ...((recentMeals || []).filter((r) => !isFav(r.food_name))),
  ].slice(0, 10) : [];

  return (
    <>
      {!pending && (
        <>
          {quickPicks.length > 0 && (
            <div className="mb-4">
              <div className="ft-body mb-1.5" style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Quick log</div>
              <div className="flex gap-2 overflow-x-auto pb-1" style={{ minWidth: 0, width: "100%" }}>
                {quickPicks.map((m, i) => (
                  <div key={m.id || i} className="flex flex-col gap-1.5 p-2.5 flex-shrink-0" style={{ background: C.card, borderRadius: 12, minWidth: 128, border: `1px solid ${C.line}` }}>
                    <button onClick={() => quickLog(m)} className="text-left">
                      <div className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{m.food_name}</div>
                      <div className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{Math.round(num(m.calories))} kcal</div>
                    </button>
                    <button onClick={() => onToggleFavorite && onToggleFavorite(m)} className="self-end">
                      <Star size={13} color={C.tan} fill={isFav(m.food_name) ? C.tan : "none"} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2 mb-3 mt-1">
            <button onClick={() => { setMode("photo"); setError(null); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: mode === "photo" ? C.ink : C.card, color: mode === "photo" ? C.onInk : C.ink, fontSize: 13, fontWeight: 600 }}><Camera size={15} /> Photo</button>
            <button onClick={() => { setMode("text"); setError(null); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: mode === "text" ? C.ink : C.card, color: mode === "text" ? C.onInk : C.ink, fontSize: 13, fontWeight: 600 }}><Type size={15} /> Describe</button>
            <button onClick={() => { setMode("barcode"); setError(null); setBarcodeError(null); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
              style={{ background: mode === "barcode" ? C.ink : C.card, color: mode === "barcode" ? C.onInk : C.ink, fontSize: 13, fontWeight: 600 }}><ScanBarcode size={15} /> Barcode</button>
          </div>
          {mode === "photo" ? (
            <div className="mb-3">
              <input id={photoInputId} type="file" accept="image/*" capture="environment" onChange={handleImagePick} className="hidden" />
              <input id={galleryInputId} type="file" accept="image/*" onChange={handleImagePick} className="hidden" />
              <input id={photoInputId2} type="file" accept="image/*" capture="environment" onChange={(e) => handleImagePick(e, 2)} className="hidden" />
              <input id={galleryInputId2} type="file" accept="image/*" onChange={(e) => handleImagePick(e, 2)} className="hidden" />
              {compressing ? (
                <div className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl" style={{ border: `2px dashed ${C.track}`, background: C.card }}>
                  <Loader2 size={22} color={C.orange} className="animate-spin" /><span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>Optimizing photo…</span>
                </div>
              ) : imagePreview ? (
                <div>
                  <div className="relative">
                    <img src={`data:${imagePreview.mediaType};base64,${imagePreview.b64}`} alt="Meal preview" style={{ width: "100%", height: 160, objectFit: "cover", borderRadius: 16 }} />
                    <button onClick={() => { setImagePreview(null); setImagePreview2(null); }} className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(21,23,27,0.7)" }}><X size={14} color="#fff" /></button>
                  </div>
                  {/* A second angle is entirely optional — one photo already works fine,
                      this just gives the AI a depth/height cue when you want extra accuracy. */}
                  {imagePreview2 ? (
                    <div className="relative mt-2">
                      <img src={`data:${imagePreview2.mediaType};base64,${imagePreview2.b64}`} alt="Second angle preview" style={{ width: "100%", height: 100, objectFit: "cover", borderRadius: 16 }} />
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-full" style={{ background: "rgba(21,23,27,0.6)" }}>
                        <span className="ft-body" style={{ fontSize: 10.5, color: "#fff", fontWeight: 600 }}>2nd angle</span>
                      </div>
                      <button onClick={() => setImagePreview2(null)} className="absolute top-2 right-2 p-1.5 rounded-full" style={{ background: "rgba(21,23,27,0.7)" }}><X size={14} color="#fff" /></button>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <label htmlFor={photoInputId2} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl cursor-pointer" style={{ border: `1.5px dashed ${C.track}`, background: "transparent" }}>
                        <Camera size={14} color={C.inkSoft} /><span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>Add another angle (optional)</span>
                      </label>
                      <label htmlFor={galleryInputId2} className="flex items-center justify-center px-3 py-2.5 rounded-xl cursor-pointer" style={{ border: `1.5px dashed ${C.track}`, background: "transparent" }}>
                        <Layers size={14} color={C.inkSoft} />
                      </label>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex gap-2.5">
                  <label htmlFor={photoInputId} className="flex-1 flex flex-col items-center justify-center gap-2 py-8 rounded-2xl cursor-pointer" style={{ border: `2px dashed ${C.track}`, background: C.card }}>
                    <Camera size={22} color={C.orange} /><span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>Take photo</span>
                  </label>
                  <label htmlFor={galleryInputId} className="flex-1 flex flex-col items-center justify-center gap-2 py-8 rounded-2xl cursor-pointer" style={{ border: `2px dashed ${C.track}`, background: C.card }}>
                    <Layers size={22} color={C.orange} /><span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>Choose from gallery</span>
                  </label>
                </div>
              )}
            </div>
          ) : mode === "text" ? (
            <div className="relative mb-3">
              <style>{`
                @keyframes voiceRingPulse { 0% { transform: scale(1); opacity: 0.55; } 100% { transform: scale(2.1); opacity: 0; } }
                .voice-ring { animation: voiceRingPulse 1.6s ease-out infinite; }
                .voice-ring-2 { animation-delay: .8s; }
                @keyframes voiceWaveBounce { 0%, 100% { height: 4px; } 50% { height: 15px; } }
                .voice-wave-bar { animation: voiceWaveBounce .9s ease-in-out infinite; }
                @keyframes wordPopIn { 0% { opacity: 0; transform: translateY(4px) scale(0.9); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
                .anim-word-in { display: inline-block; animation: wordPopIn .22s ease both; }
              `}</style>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 2 rotis, one bowl dal, 100g paneer"
                className="w-full p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 14, minHeight: 90, resize: "none", outline: "none", paddingRight: 46 }} />
              {speechSupported && (
                <div className="absolute" style={{ top: 10, right: 10, width: 30, height: 30 }}>
                  {listening && (
                    <>
                      <span className="voice-ring" style={{ position: "absolute", inset: -6, borderRadius: "50%", border: `2px solid ${C.pink}`, pointerEvents: "none" }} />
                      <span className="voice-ring voice-ring-2" style={{ position: "absolute", inset: -6, borderRadius: "50%", border: `2px solid ${C.pink}`, pointerEvents: "none" }} />
                    </>
                  )}
                  <button onClick={toggleVoiceInput} type="button" className="absolute flex items-center justify-center" title={listening ? "Stop listening" : "Speak your meal"}
                    style={{
                      inset: 0, borderRadius: "50%",
                      background: voiceJustFinished ? C.green : listening ? C.pink : C.orangeTint,
                      transform: voiceJustFinished ? "scale(0.88)" : "scale(1)",
                      transition: "background .25s ease, transform .3s cubic-bezier(.34,1.56,.64,1)",
                    }}>
                    {voiceJustFinished ? <Check size={14} color="#fff" strokeWidth={3} className="anim-check-pop" /> : <Mic size={14} color={listening ? "#fff" : C.orange} />}
                  </button>
                </div>
              )}
              {listening && (
                <div className="flex items-end gap-1" style={{ position: "absolute", top: 46, right: 12, height: 16 }}>
                  {[0.7, 0.95, 0.8, 1.05, 0.75].map((dur, i) => (
                    <span key={i} className="voice-wave-bar" style={{ width: 3, borderRadius: 2, background: C.pink, animationDuration: `${dur}s`, animationDelay: `${i * 0.09}s` }} />
                  ))}
                </div>
              )}
              {listening && (
                <div className="ft-body mt-1.5" style={{ fontSize: 12.5, color: C.ink, minHeight: 18, lineHeight: 1.4 }}>
                  {description.trim() ? (
                    description.trim().split(/\s+/).map((w, i) => <span key={i} className="anim-word-in" style={{ marginRight: 4 }}>{w}</span>)
                  ) : (
                    <span style={{ color: C.pink }}>Listening… speak naturally, e.g. "2 rotis, one bowl dal, and 100 grams paneer"</span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-3">
              <div className="ft-body mb-2.5" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>
                Best for packaged/branded foods — matches the barcode to the manufacturer's label instead of guessing from a photo.
              </div>
              <button onClick={scanBarcodeNative} disabled={scanningBarcode} className="w-full flex items-center justify-center gap-2 py-3.5 mb-2.5 rounded-2xl ft-body"
                style={{ border: `2px dashed ${C.track}`, background: C.card, color: C.ink, fontSize: 13.5, fontWeight: 600 }}>
                <ScanBarcode size={18} color={C.orange} />{scanningBarcode ? "Looking up…" : "Scan with camera"}
              </button>
              <div className="flex gap-2 mb-2.5">
                <input value={barcodeInput} onChange={(e) => setBarcodeInput(e.target.value)} inputMode="numeric" placeholder="Or type the barcode number"
                  className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 14, outline: "none" }} />
                <button onClick={() => runBarcodeLookup(barcodeInput)} disabled={scanningBarcode || !barcodeInput.trim()} className="px-4 rounded-2xl ft-body flex items-center justify-center"
                  style={{ background: C.ink, color: C.onInk, fontSize: 13, fontWeight: 600, opacity: scanningBarcode ? 0.7 : 1 }}>
                  {scanningBarcode ? <Loader2 size={15} className="animate-spin" /> : "Look up"}
                </button>
              </div>
              {barcodeError && (
                <div className="flex items-start gap-2 p-2.5 mb-2.5 rounded-xl" style={{ background: C.pinkTint }}>
                  <AlertCircle size={15} color={C.pink} style={{ flexShrink: 0, marginTop: 1 }} /><span className="ft-body" style={{ fontSize: 12, color: C.pink }}>{barcodeError}</span>
                </div>
              )}
              {scannedProduct && (
                <div className="p-3 rounded-2xl" style={{ background: C.card }}>
                  <div className="flex items-center gap-2 mb-1">
                    <ConfidenceBadge level="high" />
                    <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>Matched via barcode</span>
                  </div>
                  <div className="ft-body mb-0.5" style={{ fontSize: 14.5, fontWeight: 700, color: C.ink }}>{scannedProduct.name}</div>
                  {scannedProduct.brand && <div className="ft-body mb-2" style={{ fontSize: 12, color: C.inkSoft }}>{scannedProduct.brand}</div>}
                  <div className="ft-mono mb-3" style={{ fontSize: 12, color: C.inkSoft }}>
                    Per 100g: {Math.round(scannedProduct.per100g.calories)} kcal · P{Math.round(scannedProduct.per100g.protein_g)} C{Math.round(scannedProduct.per100g.carbs_g)} F{Math.round(scannedProduct.per100g.fat_g)}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="ft-body flex-shrink-0" style={{ fontSize: 12.5, color: C.ink, fontWeight: 600 }}>Quantity (g)</span>
                    <input value={barcodeQuantity} onChange={(e) => setBarcodeQuantity(e.target.value)} inputMode="decimal"
                      className="flex-1 p-2.5 rounded-xl ft-mono text-right" style={{ border: "none", background: C.bgBottom, color: C.ink, fontSize: 14, outline: "none" }} />
                  </div>
                  <button onClick={applyBarcodeQuantity} className="w-full flex items-center justify-center gap-2 py-3 mt-3 rounded-full ft-body" style={{ background: C.ink, color: C.onInk, fontSize: 13.5, fontWeight: 600 }}>
                    <Utensils size={15} /> Use this
                  </button>
                </div>
              )}
            </div>
          )}
          {error && (<div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.pinkTint }}><AlertCircle size={15} color={C.pink} style={{ flexShrink: 0, marginTop: 1 }} /><span className="ft-body" style={{ fontSize: 12, color: C.pink }}>{error}</span></div>)}
          {mode !== "barcode" && (
            <>
              <button onClick={() => analyze()} onPointerDown={addRippleEffect} disabled={analyzing || compressing} className="ripple-btn w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body" style={{ background: C.ink, color: C.onInk, fontSize: 14, fontWeight: 600, opacity: analyzing ? 0.7 : 1 }}>
                {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Utensils size={16} />}{analyzing ? "Analyzing meal…" : "Analyze meal"}
              </button>
              {analyzing && <MealAnalyzingCard imagePreview={mode === "photo" ? imagePreview : null} />}
            </>
          )}
          <button onClick={() => { setPending({ ...EMPTY_MEAL }); setAiEstimate(null); setShowWhyEstimate(false); setShowFullDetails(true); }}
            className="w-full flex items-center justify-center py-2.5 mt-2 ft-body" style={{ color: C.inkSoft, fontSize: 12.5, fontWeight: 500 }}>Skip — enter nutrition manually</button>
        </>
      )}
      {pending && (
        <div className="anim-result-spring-in">
          <style>{`
            @keyframes resultSpringIn { 0% { opacity: 0; transform: scale(0.94) translateY(6px); } 60% { opacity: 1; transform: scale(1.015) translateY(0); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
            .anim-result-spring-in { animation: resultSpringIn 0.45s cubic-bezier(.34,1.4,.64,1) both; }
            @keyframes resultFadeIn { 0% { opacity: 0; transform: translateY(4px); } 100% { opacity: 1; transform: translateY(0); } }
            .anim-result-fade-in { animation: resultFadeIn 0.4s ease both; }
            @keyframes resultItemPopIn { 0% { opacity: 0; transform: translateY(8px); } 100% { opacity: 1; transform: translateY(0); } }
            .anim-result-item-pop { animation: resultItemPopIn 0.35s ease both; }
            @keyframes resultSlideUp { 0% { opacity: 0; transform: translateY(10px); } 100% { opacity: 1; transform: translateY(0); } }
            .anim-result-slide-up { animation: resultSlideUp 0.4s ease both; }
          `}</style>

          {pending.confidence && pending.confidence !== "manual" && !showFullDetails ? (
            <MealCompleteSummary pending={pending} goals={goals} justAnalyzed={justAnalyzed} onViewDetails={() => setShowFullDetails(true)} />
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 mb-1">
                <input value={pending.food_name} onChange={(e) => updateField("food_name", e.target.value)} placeholder="Meal name" className="flex-1 ft-display"
                  style={{ fontSize: 20, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none", borderBottom: `1px solid ${C.line}`, paddingBottom: 4 }} />
                <button onClick={() => onToggleFavorite && onToggleFavorite(pending)} className="p-1.5" style={{ flexShrink: 0 }} title="Favorite this meal">
                  <Star size={18} color={C.tan} fill={isFav(pending.food_name) ? C.tan : "none"} />
                </button>
              </div>
              <input value={pending.estimated_portion} onChange={(e) => updateField("estimated_portion", e.target.value)} placeholder="Portion (e.g. 1 cup, 200g)"
                className="w-full ft-body mb-2" style={{ fontSize: 12, color: C.inkSoft, background: "transparent", border: "none", outline: "none" }} />

              {pending.confidence && pending.confidence !== "manual" && (
                <button onClick={() => setShowFullDetails(false)} className="flex items-center gap-1 mb-2.5 ft-body" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>
                  <ChevronLeft size={13} /> Back to summary
                </button>
              )}

              {pending.confidence && pending.confidence !== "manual" && (
                <div className="mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className={justAnalyzed ? "anim-result-fade-in" : ""}><ConfidenceBadge level={pending.confidence} /></div>
                    {pending.estimate_basis && (
                      <button onClick={() => setShowWhyEstimate((s) => !s)} className="ft-body flex items-center gap-1" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>
                        Why this estimate? <ChevronDown size={11} style={{ transform: showWhyEstimate ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
                      </button>
                    )}
                    {pending.items && pending.items.length > 1 && (
                      <button onClick={() => setShowItemBreakdown((s) => !s)} className="ft-body flex items-center gap-1" style={{ fontSize: 12, color: C.inkSoft, fontWeight: 600 }}>
                        Item breakdown ({pending.items.length}) <ChevronDown size={11} style={{ transform: showItemBreakdown ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
                      </button>
                    )}
                    {aiEstimate && (
                      <div className="flex items-center gap-1.5 ml-auto">
                        {quickFeedbackGiven ? (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, fontWeight: 600 }}>
                            {quickFeedbackGiven === "up" ? "Thanks — glad it's close" : "Thanks — we'll be more careful with this one"}
                          </span>
                        ) : (
                          <>
                            <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>Look right?</span>
                            <button onClick={() => giveQuickFeedback(true)} className="p-1 rounded-full" style={{ background: C.card }} title="Looks about right">
                              <ThumbsUp size={13} color={C.inkSoft} />
                            </button>
                            <button onClick={() => giveQuickFeedback(false)} className="p-1 rounded-full" style={{ background: C.card }} title="Doesn't look right">
                              <ThumbsDown size={13} color={C.inkSoft} />
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {showWhyEstimate && pending.estimate_basis && (
                    <div className="mt-2 p-2.5 rounded-xl" style={{ background: C.bgBottom }}>
                      <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>{pending.estimate_basis}</span>
                    </div>
                  )}
                  {/* Food Breakdown — each detected item as its own row (icon,
                      name + portion, calories + macros), matching the
                      reference design's dedicated breakdown screen. */}
                  {showItemBreakdown && pending.items && pending.items.length > 1 && (
                    <div className="mt-2 p-2 rounded-xl flex flex-col gap-1.5" style={{ background: C.bgBottom }}>
                      {pending.items.map((it, i) => {
                        const palette = [
                          { bg: C.orangeTint, fg: C.orange }, { bg: C.greenTint, fg: C.green },
                          { bg: C.tanTint, fg: C.tan }, { bg: C.pinkTint, fg: C.pink },
                          { bg: C.blueTint, fg: C.blue }, { bg: C.purpleTint, fg: C.purple },
                        ][i % 6];
                        return (
                          <div key={i} className={justAnalyzed ? "anim-result-item-pop flex items-center gap-2.5 p-1.5" : "flex items-center gap-2.5 p-1.5"}
                            style={justAnalyzed ? { animationDelay: `${i * 90}ms` } : undefined}>
                            <div className="flex items-center justify-center flex-shrink-0" style={{ width: 36, height: 36, borderRadius: "50%", background: palette.bg }}>
                              <Utensils size={15} color={palette.fg} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <input value={it.food_name} onChange={(e) => updateItemField(i, "food_name", e.target.value)} onClick={(e) => e.stopPropagation()}
                                  className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none", padding: 0, minWidth: 0, flex: 1 }} />
                                <span className="ft-mono flex-shrink-0" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{Math.round(it.calories)} kcal</span>
                              </div>
                              <div className="flex items-center justify-between gap-2 mt-0.5">
                                <input value={it.estimated_portion || ""} onChange={(e) => updateItemField(i, "estimated_portion", e.target.value)} onClick={(e) => e.stopPropagation()}
                                  placeholder="portion" className="ft-body" style={{ fontSize: 11, color: C.inkSoft, background: "transparent", border: "none", outline: "none", padding: 0, minWidth: 0, flex: 1 }} />
                                <span className="ft-mono flex-shrink-0" style={{ fontSize: 11, color: C.inkSoft }}>P{Math.round(it.protein_g)} C{Math.round(it.carbs_g)} F{Math.round(it.fat_g)}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {nutritionIsStale && (
                <div className="flex items-center justify-between gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.orangeTint }}>
                  <span className="ft-body" style={{ fontSize: 12, color: C.orangeDeep, lineHeight: 1.35 }}>{portionIsStale ? "Portion changed" : "Item portions changed"} — nutrition below is for the old amount.</span>
                  <button onClick={recalculateFromPortion} disabled={recalculating} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full ft-body flex-shrink-0"
                    style={{ background: C.ink, color: C.onInk, fontSize: 12, fontWeight: 600, opacity: recalculating ? 0.7 : 1 }}>
                    {recalculating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{recalculating ? "Recalculating…" : "Recalculate nutrition"}
                  </button>
                </div>
              )}

              {/* Portion Advice — a scored banner (verdict-colored, like the
                  reference design's "Good portion!" card) plus a short list
                  of suggestions built from data already on the meal. */}
              {pending.portion_guidance ? (
                <PortionAdviceCard pending={pending} justAnalyzed={justAnalyzed} goals={goals} />
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
                {!editingEntry && (
                  <button onClick={() => { setPending(null); setAiEstimate(null); setShowWhyEstimate(false); }} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.card, color: C.ink, fontSize: 14, fontWeight: 600 }}><X size={16} /> Back</button>
                )}
                <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> {editingEntry ? "Save changes" : "Save log"}</button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function ExerciseForm({ exerciseLogs, onSave, editingEntry, splits }) {
  const [exType, setExType] = useState(editingEntry ? editingEntry.type : "strength");
  const [name, setName] = useState(editingEntry ? editingEntry.name : "");
  const activeSplit = splits && splits[0];
  const [splitDayId, setSplitDayId] = useState(null);
  const splitDay = activeSplit && activeSplit.days.find((d) => d.id === splitDayId);
  const [sets, setSets] = useState(
    editingEntry && editingEntry.type === "strength" && editingEntry.sets && editingEntry.sets.length
      ? editingEntry.sets.map((s) => ({ weight: s.weight === 0 || s.weight ? String(s.weight) : "", reps: s.reps === 0 || s.reps ? String(s.reps) : "" }))
      : [{ weight: "", reps: "" }]
  );
  const [durationMin, setDurationMin] = useState(editingEntry && editingEntry.type === "cardio" ? String(editingEntry.duration_min ?? "") : "");
  const [distanceKm, setDistanceKm] = useState(editingEntry && editingEntry.type === "cardio" ? String(editingEntry.distance_km ?? "") : "");
  const [effort, setEffort] = useState(editingEntry && editingEntry.type === "cardio" ? (editingEntry.effort || "moderate") : "moderate");
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [ai, setAi] = useState(editingEntry ? editingEntry.ai || null : null);
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
      const raw = await callGemini([{ type: "text", text: buildExercisePrompt({ entry, history }) }]);
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
    const entry = editingEntry
      ? { id: editingEntry.id, date: editingEntry.date, timestamp: editingEntry.timestamp, ...buildEntry(), ai }
      : { id: uid(), date: todayStr(), timestamp: Date.now(), ...buildEntry(), ai };
    await onSave(entry);
  }

  return (
    <div>
      {!editingEntry && activeSplit && activeSplit.days.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center gap-1.5 mb-2">
            <Layers size={13} color={C.inkSoft} />
            <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 600 }}>{activeSplit.name}</span>
          </div>
          <div className="flex gap-1.5 mb-2" style={{ overflowX: "auto", minWidth: 0, width: "100%" }}>
            {activeSplit.days.map((d) => (
              <button key={d.id} onClick={() => setSplitDayId(d.id === splitDayId ? null : d.id)} className="flex-shrink-0 px-3 py-1.5 rounded-full ft-body"
                style={{ background: splitDayId === d.id ? C.blue : C.card, color: splitDayId === d.id ? "#fff" : C.ink, fontSize: 12, fontWeight: 600 }}>
                {d.label}
              </button>
            ))}
          </div>
          {splitDay && (
            splitDay.exercises.length === 0 ? (
              <div className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>No exercises added to this day yet — edit your split in Profile.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {splitDay.exercises.map((ex, i) => {
                  const doneToday = exerciseLogs.some((e) => e.date === todayStr() && e.name.trim().toLowerCase() === ex.trim().toLowerCase());
                  return (
                    <button key={i} onClick={() => setName(ex)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full ft-body"
                      style={{ background: name === ex ? C.ink : doneToday ? C.greenTint : C.card, color: name === ex ? C.onInk : doneToday ? C.green : C.ink, fontSize: 12.5, fontWeight: 500 }}>
                      {doneToday && <Check size={11} />}{ex}
                    </button>
                  );
                })}
              </div>
            )
          )}
        </div>
      )}
      <div className="flex gap-2 mb-3 mt-1">
        <button onClick={() => setExType("strength")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
          style={{ background: exType === "strength" ? C.ink : C.card, color: exType === "strength" ? C.onInk : C.ink, fontSize: 13, fontWeight: 600 }}><Dumbbell size={15} /> Strength</button>
        <button onClick={() => setExType("cardio")} className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-full ft-body"
          style={{ background: exType === "cardio" ? C.ink : C.card, color: exType === "cardio" ? C.onInk : C.ink, fontSize: 13, fontWeight: 600 }}><Activity size={15} /> Cardio</button>
      </div>

      <input
  value={name}
  onChange={(e) => setName(e.target.value)}
  placeholder={exType === "strength" ? "e.g. Bench press" : "e.g. Running"}
  className="w-full p-3 rounded-2xl ft-body mb-3"
  style={{
    border: "none",
    background: C.card,
    color: C.ink,
    fontSize: 14,
    outline: "none",
    WebkitTextFillColor: C.ink,
  }}
/>

      {exType === "strength" ? (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Sets</span>
            <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>kg × reps</span>
          </div>
          <div className="flex flex-col gap-2">
            {sets.map((s, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5" style={{ background: C.card, borderRadius: 16 }}>
                <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft, width: 16 }}>{i + 1}</span>
                <input type="number" inputMode="decimal" value={s.weight} onChange={(e) => updateSet(i, "weight", e.target.value)} placeholder="Weight"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, color: C.ink, borderRadius: 12, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
                <span className="ft-body" style={{ color: C.inkSoft, fontSize: 12 }}>×</span>
                <input type="number" inputMode="numeric" value={s.reps} onChange={(e) => updateSet(i, "reps", e.target.value)} placeholder="Reps"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, color: C.ink, borderRadius: 12, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
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
              className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 13, outline: "none" }} />
            <input type="number" inputMode="decimal" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="Distance (km)"
              className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 13, outline: "none" }} />
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
        <div className="p-4 mb-3" style={{ background: C.card, borderRadius: 16 }}>
          <div className="flex items-center justify-between mb-2">
            <TrendBadge trend={ai.trend} />
            <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>~{ai.estimated_calories} kcal</span>
          </div>
          {ai.muscle_groups.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {ai.muscle_groups.map((m, i) => (
                <span key={i} className="ft-body px-2 py-1" style={{ background: C.blueTint, color: C.blue, borderRadius: 999, fontSize: 12, fontWeight: 600 }}>{m}</span>
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
          {ai.form_tip && <div className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, lineHeight: 1.4, fontStyle: "italic" }}>Cue: {ai.form_tip}</div>}
        </div>
      )}

      <div className="flex gap-2">
        {ai && <button onClick={() => setAi(null)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.card, color: C.ink, fontSize: 14, fontWeight: 600 }}><X size={16} /> Redo</button>}
        <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.blue, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> {editingEntry ? "Save changes" : "Save workout"}</button>
      </div>
      {!ai && <div className="ft-body text-center mt-2" style={{ fontSize: 12.5, color: C.inkSoft }}>You can save without AI feedback too.</div>}
    </div>
  );
}


   
function ProfilePanel({ goals, onSaveGoals, weights, onDeleteWeight, darkMode, setDarkMode, splits, onSaveSplits }) {
  const [local, setLocal] = useState(goals);
  const [saved, setSaved] = useState(false);
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [goalsSectionOpen, setGoalsSectionOpen] = useState(false);
  const [exerciseSettingsOpen, setExerciseSettingsOpen] = useState(false);
  // Brief cover-fade used purely for the dark/light toggle below — the
  // theme swap itself is still instant (colors come from a single C=...
  // token object used everywhere, not something safe to add per-element
  // transitions to), but fading a plain overlay in and back out right as it
  // swaps reads as one smooth crossfade rather than a hard flash.
  const [themeFlash, setThemeFlash] = useState(false);
  useEffect(() => setLocal(goals), [goals]);

  function toggleGoalsEditing() {
    if (goalsEditing) setLocal(goals); // discard any unsaved edits on cancel
    setSaved(false);
    setGoalsEditing((o) => !o);
  }
  function toggleTheme() {
    setThemeFlash(true);
    setTimeout(() => {
      setDarkMode(!darkMode);
      setTimeout(() => setThemeFlash(false), 200);
    }, 90);
  }

  function field(key, label, unit) {
  return (
  
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{label}</span>
          <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{unit}</span>
        </div>
        <input type="number" value={local[key]} onChange={(e) => { setLocal((p) => ({ ...p, [key]: num(e.target.value) })); setSaved(false); }}
          className="w-full p-3 rounded-2xl ft-mono" style={{ border: "none", background: C.card, color: C.ink, fontSize: 16, outline: "none" }} />
      </div>
    );
  }

  return (
    <div>
    <style>{`
      @keyframes settingsSectionOpen { 0% { opacity: 0; transform: translateY(-6px); } 100% { opacity: 1; transform: translateY(0); } }
      .anim-section-open { animation: settingsSectionOpen .22s ease both; }
      @keyframes settingsEditSlideIn { 0% { opacity: 0; transform: translateX(10px); } 100% { opacity: 1; transform: translateX(0); } }
      .anim-edit-slide-in { animation: settingsEditSlideIn .22s ease both; }
      @keyframes themeFlashFade { 0% { opacity: 0; } 50% { opacity: 1; } 100% { opacity: 0; } }
      .anim-theme-flash { animation: themeFlashFade .29s ease both; }
      @keyframes settingsSavedPop { 0% { opacity: 0; transform: scale(0.7); } 60% { opacity: 1; transform: scale(1.1); } 100% { opacity: 1; transform: scale(1); } }
      .anim-saved-pop { animation: settingsSavedPop .35s cubic-bezier(.22,.9,.34,1) both; }
    `}</style>
    {themeFlash && (
      <div className="anim-theme-flash" style={{ position: "fixed", inset: 0, background: darkMode ? LIGHT.bgBottom : DARK.bgBottom, zIndex: 200, pointerEvents: "none" }} />
    )}
    <div
      className="flex items-center justify-between p-4 mb-4"
      style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}
    >
      <span
        className="ft-body"
        style={{ fontSize: 14, fontWeight: 600, color: C.ink }}
      >
        🌙 Dark Mode
      </span>

      <button
        onClick={toggleTheme}
        aria-pressed={darkMode}
        className="relative"
        style={{
          width: 52,
          height: 30,
          borderRadius: 999,
          background: darkMode ? C.green : C.track,
          border: "none",
          padding: 0,
          cursor: "pointer",
          transition: "background .2s ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: darkMode ? 25 : 3,
            width: 24,
            height: 24,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            transition: "left .2s ease",
          }}
        />
      </button>
    </div>

      <button onClick={() => setGoalsSectionOpen((o) => !o)} className="w-full flex items-center justify-between p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
        <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Daily goals</span>
        <ChevronDown size={16} color={C.inkSoft} style={{ transform: goalsSectionOpen ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {goalsSectionOpen && (
      <div className="anim-section-open p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
        <div className="flex items-center justify-end mb-1">
          <button onClick={toggleGoalsEditing} className="flex items-center gap-1 ft-body" style={{ fontSize: 12, fontWeight: 600, color: goalsEditing ? C.inkSoft : C.orange }}>
            {goalsEditing ? "Cancel" : <><Pencil size={12} /> Edit goals</>}
          </button>
        </div>

        {!goalsEditing ? (
          <div className="anim-section-open flex flex-wrap gap-x-4 gap-y-2 mt-3">
            {[
              { label: "Calories", value: `${goals.calories} kcal` },
              { label: "Protein", value: `${goals.protein}g` },
              { label: "Carbs", value: `${goals.carbs}g` },
              { label: "Fat", value: `${goals.fat}g` },
              { label: "Fiber", value: `${goals.fiber}g` },
              { label: "Water", value: `${goals.water}ml` },
              { label: "Sleep", value: fmtSleepDuration(goals.sleep || SLEEP_GOAL_MINUTES) },
              ...(goals.targetWeight > 0 ? [{ label: "Goal weight", value: `${goals.targetWeight}kg` }] : []),
              ...(goals.dietType ? [{ label: "Diet", value: goals.dietType }] : []),
              ...(goals.cuisine ? [{ label: "Cuisine", value: goals.cuisine }] : []),
            ].map((g) => (
              <div key={g.label}>
                <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>{g.label}</div>
                <div className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{g.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="anim-edit-slide-in mt-3">
            {field("calories", "Calories", "kcal")}{field("protein", "Protein", "g")}{field("carbs", "Carbohydrates", "g")}{field("fat", "Fat", "g")}{field("fiber", "Fiber", "g")}{field("water", "Water", "ml")}{field("sleep", "Sleep goal", "min")}
            {field("targetWeight", "Goal weight", "kg (0 = off)")}
            <div className="mb-3">
              <div className="mb-1"><span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Diet type</span></div>
              <div className="flex flex-wrap gap-1.5">
                {["", "Vegetarian", "Non-vegetarian", "Eggetarian", "Vegan"].map((d) => (
                  <button key={d || "unset"} onClick={() => { setLocal((p) => ({ ...p, dietType: d })); setSaved(false); }}
                    className="px-3 py-1.5 rounded-full ft-body" style={{ fontSize: 12, fontWeight: 600, background: local.dietType === d ? C.ink : C.card, color: local.dietType === d ? C.onInk : C.inkSoft, border: `1px solid ${C.track}` }}>
                    {d || "Not set"}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-3">
              <div className="mb-1"><span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>Usual cuisine</span></div>
              <input type="text" value={local.cuisine || ""} placeholder="e.g. North Indian, South Indian, Mediterranean"
                onChange={(e) => { setLocal((p) => ({ ...p, cuisine: e.target.value })); setSaved(false); }}
                className="w-full p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 14, outline: "none" }} />
              <div className="ft-body mt-1" style={{ fontSize: 11, color: C.inkSoft }}>Helps the AI recognize dishes and guess portions more accurately.</div>
            </div>
            <button onClick={async () => { await onSaveGoals(local); haptic("success"); setSaved(true); setTimeout(() => setGoalsEditing(false), 900); }} disabled={saved} className="w-full flex items-center justify-center gap-2 py-3 rounded-full ft-body"
              style={{ background: saved ? C.green : C.orange, color: "#fff", fontSize: 14, fontWeight: 600, transition: "background .2s ease" }}>
              {saved ? <><Check size={16} className="anim-saved-pop" /> Saved</> : "Save goals"}
            </button>
          </div>
        )}
      </div>
      )}

      <button onClick={() => setExerciseSettingsOpen((o) => !o)} className="w-full flex items-center justify-between p-4 mb-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
        <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Exercise settings</span>
        <ChevronDown size={16} color={C.inkSoft} style={{ transform: exerciseSettingsOpen ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {exerciseSettingsOpen && (
        <div className="anim-section-open mt-3">
          <div className="ft-body mb-2 px-1" style={{ fontSize: 12, color: C.inkSoft }}>Workout split</div>
          <WorkoutSplitEditor splits={splits} onSave={onSaveSplits} />
        </div>
      )}
    </div>
  );
}

// ---------- Sleep Tracker ----------
// Full-screen page opened from the Home "Sleep" card. A 24-hour dial (drawn
// with SVG arcs) shows the selected sleep window at a glance; the bedtime and
// wake handles can be dragged around the ring to adjust the time directly, or
// tapped (without dragging) to open the native time picker instead. "Log
// Sleep" saves one entry per day.
function angleForHour(h) { return (h / 24) * 360 - 90; }
// Inverse of angleForHour — turns a raw pointer angle (degrees, atan2 range)
// back into an hour-of-day float, used while dragging the bed/alarm handles.
function hourForAngle(angleDeg) {
  const a = ((angleDeg + 90) % 360 + 360) % 360;
  return (a / 360) * 24;
}
function hourFloatToTimeStr(hourFloat) {
  let totalMin = Math.round((hourFloat * 60) / 5) * 5; // snap to 5-minute increments
  totalMin = ((totalMin % 1440) + 1440) % 1440;
  const hh = Math.floor(totalMin / 60);
  const mm = totalMin % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function polarPoint(cx, cy, r, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function describeSleepArc(cx, cy, r, startHour, endHour) {
  const startAngle = angleForHour(startHour);
  const sweep = ((endHour - startHour) + 24) % 24 * 15; // 15deg per hour
  const endAngle = startAngle + sweep;
  const start = polarPoint(cx, cy, r, startAngle);
  const end = polarPoint(cx, cy, r, endAngle);
  const largeArcFlag = sweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}
function SleepDial({ bedtime, wakeTime, sleepGoalMinutes = SLEEP_GOAL_MINUTES, onTapBedtime, onTapWake, onDragBedtime, onDragWake }) {
  const size = 240, cx = size / 2, cy = size / 2, r = 96, trackWidth = 15;
  const [bh, bm] = bedtime.split(":").map(Number);
  const [wh, wm] = wakeTime.split(":").map(Number);
  const bedHour = bh + bm / 60, wakeHour = wh + wm / 60;
  const arcPath = describeSleepArc(cx, cy, r, bedHour, wakeHour);
  const bedPos = polarPoint(cx, cy, r, angleForHour(bedHour));
  const wakePos = polarPoint(cx, cy, r, angleForHour(wakeHour));
  const moonPos = polarPoint(cx, cy, r - trackWidth / 2 - 16, angleForHour(0));
  const sunPos = polarPoint(cx, cy, r - trackWidth / 2 - 16, angleForHour(12));
  const durationMins = sleepDurationMinutes(bedtime, wakeTime);
  const quality = sleepQuality(durationMins, sleepGoalMinutes);

  // The arc "draws itself" once when the dial first mounts (bedOffset 100 ->
  // 0, using pathLength=100 so the dash math is independent of the arc's
  // actual geometric length/sweep). Deliberately doesn't reset on every
  // bedtime/wake change afterward — while dragging, the arc should track the
  // finger instantly, not replay a draw-in each time.
  const [arcOffset, setArcOffset] = useState(100);
  useEffect(() => {
    const t = setTimeout(() => setArcOffset(0), 50);
    return () => clearTimeout(t);
  }, []);

  // Dragging: track which handle (if any) is active via pointer capture, so
  // movement is tracked even once the finger/cursor leaves the small handle.
  // A short tap (no meaningful movement) still falls through to the native
  // time picker via onTapBedtime/onTapWake, same as before.
  const dialRef = useRef(null);
  const draggingRef = useRef(null); // "bed" | "wake" | null
  const didDragRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  function angleFromPointer(e) {
    const el = dialRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left - cx;
    const py = e.clientY - rect.top - cy;
    return (Math.atan2(py, px) * 180) / Math.PI;
  }
  function startDrag(which) {
    return (e) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      draggingRef.current = which;
      didDragRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
    };
  }
  function onDragMove(e) {
    if (!draggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x, dy = e.clientY - dragStartRef.current.y;
    if (Math.hypot(dx, dy) > 4) didDragRef.current = true;
    const timeStr = hourFloatToTimeStr(hourForAngle(angleFromPointer(e)));
    if (draggingRef.current === "bed") onDragBedtime(timeStr);
    else onDragWake(timeStr);
  }
  function endDrag() { draggingRef.current = null; }
  function tapIfNoDrag(fn) { return () => { if (!didDragRef.current) fn(); }; }

  return (
    <div ref={dialRef} className="relative flex items-center justify-center" style={{ width: size, height: size, margin: "0 auto" }}>
      <style>{`
        @keyframes dialTwinkle { 0%, 100% { opacity: 0.12; } 50% { opacity: 0.6; } }
        .dial-star { animation: dialTwinkle 4s ease-in-out infinite; }
        @keyframes dialMoonGlow { 0%, 100% { filter: drop-shadow(0 0 0px rgba(139,127,209,0.7)); } 50% { filter: drop-shadow(0 0 4px rgba(139,127,209,0.9)); } }
        .dial-moon-good { animation: dialMoonGlow 3.6s ease-in-out infinite; }
        @keyframes dialMoonWarn { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        .dial-moon-warn { animation: dialMoonWarn 3.6s ease-in-out infinite; }
      `}</style>
      <svg width={size} height={size} style={{ position: "absolute", inset: 0 }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={C.track} strokeWidth={trackWidth} />
        {/* A few faint, slowly twinkling stars scattered inside the dial —
            calm ambient texture, not tied to any data. */}
        <circle className="dial-star" cx={cx - 34} cy={cy - 12} r="1.6" fill={C.purple} style={{ animationDelay: "0s" }} />
        <circle className="dial-star" cx={cx + 30} cy={cy + 22} r="1.3" fill={C.purple} style={{ animationDelay: "1.4s" }} />
        <circle className="dial-star" cx={cx + 8} cy={cy - 30} r="1.3" fill={C.purple} style={{ animationDelay: "2.6s" }} />
        <path d={arcPath} fill="none" stroke={C.blue} strokeWidth={trackWidth} strokeLinecap="round" pathLength={100} strokeDasharray={100} strokeDashoffset={arcOffset}
          style={{ transition: "stroke-dashoffset 1.3s cubic-bezier(.22,.9,.34,1)" }} />
        {Array.from({ length: 12 }).map((_, i) => {
          const h = i * 2;
          const p1 = polarPoint(cx, cy, r - trackWidth / 2 - 4, angleForHour(h));
          return (
            <text key={h} x={p1.x} y={p1.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fontWeight="600" fill={C.inkSoft} fontFamily="inherit">{h}</text>
          );
        })}
      </svg>
      <Moon size={13} color={C.purple} className={quality === "good" ? "dial-moon-good" : quality === "poor" ? "dial-moon-warn" : ""} style={{ position: "absolute", left: moonPos.x - 6.5, top: moonPos.y - 6.5 }} />
      <Sunrise size={13} color={C.tan} style={{ position: "absolute", left: sunPos.x - 6.5, top: sunPos.y - 6.5 }} />
      <button
        onClick={tapIfNoDrag(onTapBedtime)}
        onPointerDown={startDrag("bed")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex items-center justify-center" style={{ position: "absolute", left: bedPos.x - 17, top: bedPos.y - 17, width: 34, height: 34, borderRadius: "50%", background: C.blue, border: `3px solid ${C.card}`, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", touchAction: "none", cursor: "grab" }}>
        <BedDouble size={15} color="#fff" />
      </button>
      <button
        onClick={tapIfNoDrag(onTapWake)}
        onPointerDown={startDrag("wake")}
        onPointerMove={onDragMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="flex items-center justify-center" style={{ position: "absolute", left: wakePos.x - 17, top: wakePos.y - 17, width: 34, height: 34, borderRadius: "50%", background: C.green, border: `3px solid ${C.card}`, boxShadow: "0 2px 8px rgba(0,0,0,0.2)", touchAction: "none", cursor: "grab" }}>
        <AlarmClock size={15} color="#fff" />
      </button>
      <div className="flex flex-col items-center" style={{ position: "absolute" }}>
        <span className="ft-display" style={{ fontSize: 24, fontWeight: 700, color: C.ink }}>{fmtSleepDuration(durationMins)}</span>
      </div>
    </div>
  );
}
function SleepTrackerScreen({ sleepLogs, goals, onSave, onClose }) {
  const latest = sleepLogs.length ? [...sleepLogs].sort((a, b) => b.timestamp - a.timestamp)[0] : null;
  const [bedtime, setBedtime] = useState(latest ? latest.bedtime : "22:45");
  const [wakeTime, setWakeTime] = useState(latest ? latest.wakeTime : "07:00");
  const [reminderOn, setReminderOn] = useState(false); // display-only toggle, matches the reference design
  const bedInputRef = useRef(null);
  const wakeInputRef = useRef(null);
  const durationMins = sleepDurationMinutes(bedtime, wakeTime);
  const sleepGoalMinutes = (goals && goals.sleep) || SLEEP_GOAL_MINUTES;

  function openPicker(ref) {
    const el = ref.current;
    if (!el) return;
    if (el.showPicker) el.showPicker(); else el.click();
  }

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, zIndex: 50 }}>
      <style>{`
        @keyframes sleepScreenTwinkle { 0%, 100% { opacity: 0.1; } 50% { opacity: 0.5; } }
        .sleep-screen-star { animation: sleepScreenTwinkle 4.5s ease-in-out infinite; pointer-events: none; }
      `}</style>
      <div className="sleep-screen-star" style={{ position: "absolute", left: "18%", top: 28, width: 3, height: 3, borderRadius: "50%", background: C.purple, animationDelay: "0s" }} />
      <div className="sleep-screen-star" style={{ position: "absolute", left: "72%", top: 44, width: 2, height: 2, borderRadius: "50%", background: C.purple, animationDelay: "1.6s" }} />
      <div className="sleep-screen-star" style={{ position: "absolute", left: "88%", top: 22, width: 2.5, height: 2.5, borderRadius: "50%", background: C.purple, animationDelay: "3s" }} />
      <div className="sleep-screen-star" style={{ position: "absolute", left: "40%", top: 60, width: 2, height: 2, borderRadius: "50%", background: C.purple, animationDelay: "2.2s" }} />
      <div className="flex items-center px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top, 0px))", paddingBottom: 12 }}>
        <button onClick={onClose} className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: "50%", background: C.card, border: "none" }}>
          <ChevronLeft size={17} color={C.ink} />
        </button>
        <span className="ft-display flex-1 text-center" style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginRight: 34 }}>Sleep Tracker</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 32 }}>
        <div className="p-5 mb-4" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
          <SleepDial bedtime={bedtime} wakeTime={wakeTime} sleepGoalMinutes={sleepGoalMinutes} onTapBedtime={() => openPicker(bedInputRef)} onTapWake={() => openPicker(wakeInputRef)} onDragBedtime={setBedtime} onDragWake={setWakeTime} />

          <div className="flex items-center justify-around mt-5">
            <div className="relative flex flex-col items-center">
              <div className="flex items-center gap-1.5 mb-1">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue }} />
                <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>Bedtime</span>
              </div>
              <button onClick={() => openPicker(bedInputRef)} className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink, background: "none", border: "none" }}>{fmtTime12(bedtime)}</button>
              <input ref={bedInputRef} type="time" value={bedtime} onChange={(e) => setBedtime(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }} />
            </div>
            <div className="relative flex flex-col items-center">
              <div className="flex items-center gap-1.5 mb-1">
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green }} />
                <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.inkSoft }}>Wake Up Time</span>
              </div>
              <button onClick={() => openPicker(wakeInputRef)} className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink, background: "none", border: "none" }}>{fmtTime12(wakeTime)}</button>
              <input ref={wakeInputRef} type="time" value={wakeTime} onChange={(e) => setWakeTime(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, pointerEvents: "none" }} />
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="ft-body" style={{ fontSize: 11.5, fontWeight: 600, color: C.inkSoft }}>Sleep goal</span>
              <span className="ft-mono" style={{ fontSize: 11.5, color: C.inkSoft }}>{fmtSleepDuration(durationMins)} / {fmtSleepDuration(sleepGoalMinutes)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: C.track, overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: 999, background: C.purple, width: `${clamp((durationMins / sleepGoalMinutes) * 100, 0, 100)}%`, transition: "width 1s cubic-bezier(.22,.9,.34,1)" }} />
            </div>
          </div>

          <button onClick={() => { onSave(bedtime, wakeTime); onClose(); }} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body mt-5"
            style={{ background: C.blue, color: "#fff", fontSize: 15, fontWeight: 700, border: "none" }}>
            <Moon size={15} /> Log Sleep
          </button>
        </div>

        <div className="flex items-center justify-between p-4" style={{ background: C.card, borderRadius: 16 }}>
          <div>
            <div className="ft-body" style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>Bedtime reminder</div>
            <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft, marginTop: 1 }}>Limit screen time before bed</div>
          </div>
          <button
            onClick={() => setReminderOn((o) => !o)}
            aria-pressed={reminderOn}
            className="relative"
            style={{ width: 48, height: 28, borderRadius: 999, background: reminderOn ? C.green : C.track, border: "none", padding: 0, flexShrink: 0, transition: "background .2s ease" }}>
            <span style={{ position: "absolute", top: 3, left: reminderOn ? 23 : 3, width: 22, height: 22, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,0.3)", transition: "left .2s ease" }} />
          </button>
        </div>

        {sleepLogs.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <div className="ft-body px-1" style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Sleep history</div>
            {[...sleepLogs].sort((a, b) => b.timestamp - a.timestamp).map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3 rounded-2xl" style={{ background: C.card }}>
                <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>{fmtDate(s.date)}</span>
                <span className="ft-mono" style={{ fontSize: 12.5, color: C.ink }}>{fmtTime12(s.bedtime)} → {fmtTime12(s.wakeTime)}</span>
                <span className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{fmtSleepDuration(s.durationMinutes)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Weight Tracker ----------
// Full-screen page opened from the Home "Weight" card — mirrors the Sleep
// Tracker's pattern (back button, quick entry, full history list). Shows a
// trend line (reusing the same weightSeries/weightPace/weightProjection data
// already computed on Home/Insights) plus every logged weigh-in with delete.
// ---------- Nutrition Score detail screen ----------
// Opened by tapping the Score tile on Home. The ring counts up from 0 on
// mount (Ring already handles that), the breakdown bars fill in with a
// staggered delay so they read as sequential, the best-performing metric
// gets a soft glow and the weakest a gentle pulsing "focus" cue, and the
// score's move vs yesterday shows as a small delta badge. Crossing 90 or
// hitting 100 fires the app's existing celebration banner (with confetti)
// rather than inventing a separate effect.
function NutritionScoreScreen({ nutritionScore, yesterdayScore, onClose, fireCelebration }) {
  const total = nutritionScore.total;
  const delta = yesterdayScore ? total - yesterdayScore.total : null;
  const entries = Object.entries(nutritionScore.breakdown);
  const scoreColor = total >= 80 ? C.green : total >= 55 ? C.tan : C.pink;

  // Bars start at 0% and animate up to their real score just after mount, so
  // the fill reads as a fresh animation each time the screen opens rather
  // than appearing already-full.
  const [barsIn, setBarsIn] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setBarsIn(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Fire once per time the screen is opened, not on every re-render.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    if (total >= 100) {
      fireCelebration({ icon: Trophy, color: C.green, bg: C.greenTint, text: "🎉 Perfect score — 100/100!" });
    } else if (total >= 90) {
      fireCelebration({ icon: Trophy, color: C.tan, bg: C.tanTint, text: `🌟 Excellent day — ${total}/100!` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, zIndex: 50 }}>
      <style>{`
        @keyframes scoreWeakPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        .score-weak-pulse { animation: scoreWeakPulse 1.8s ease-in-out infinite; }
      `}</style>
      <div className="flex items-center px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top, 0px))", paddingBottom: 12 }}>
        <button onClick={onClose} className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: "50%", background: C.card, border: "none" }}>
          <ChevronLeft size={17} color={C.ink} />
        </button>
        <span className="ft-display flex-1 text-center" style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginRight: 34 }}>Nutrition Score</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 32 }}>
        <div className="p-5 mb-4 flex flex-col items-center" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
          <Ring size={180} stroke={16} pct={total} trackColor={C.track} fillColor={scoreColor}>
            <div className="flex flex-col items-center">
              <span className="ft-display" style={{ fontSize: 40, fontWeight: 700, color: C.ink }}><AnimatedNumber value={total} /></span>
              <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft }}>/ 100</span>
            </div>
          </Ring>
          {delta !== null && (
            <div className="anim-check-pop flex items-center gap-1 mt-3" style={{ animationDelay: ".5s", animationFillMode: "backwards" }}>
              {delta > 0 ? <TrendingUp size={14} color={C.green} /> : delta < 0 ? <TrendingDown size={14} color={C.pink} /> : <Minus size={14} color={C.inkSoft} />}
              <span className="ft-mono" style={{ fontSize: 13, fontWeight: 700, color: delta > 0 ? C.green : delta < 0 ? C.pink : C.inkSoft }}>
                {delta > 0 ? "+" : ""}{delta} vs yesterday
              </span>
            </div>
          )}
          <div className="ft-body mt-2" style={{ fontSize: 13, color: C.inkSoft, textAlign: "center", lineHeight: 1.4 }}>{nutritionScore.summary}</div>
        </div>

        <div className="p-4" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
          <div className="ft-body mb-3" style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.4, textTransform: "uppercase" }}>Breakdown</div>
          {entries.map(([key, c], i) => {
            const isBest = key === nutritionScore.bestKey;
            const isWorst = key === nutritionScore.worstKey && nutritionScore.worstKey !== nutritionScore.bestKey;
            const barColor = c.score >= 80 ? C.green : c.score >= 55 ? C.tan : C.pink;
            return (
              <div key={key} className="mb-3.5">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink, textTransform: "capitalize" }}>{c.label}</span>
                    {isBest && <Sparkles size={12} color={C.tan} />}
                    {isWorst && <span className="ft-body score-weak-pulse" style={{ fontSize: 10.5, fontWeight: 700, color: C.pink, letterSpacing: 0.3, textTransform: "uppercase" }}>Focus area</span>}
                  </div>
                  <span className="ft-mono" style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{Math.round(c.score)}</span>
                </div>
                <div style={{ position: "relative", height: 8, borderRadius: 999, background: C.track, overflow: "hidden", boxShadow: isBest ? `0 0 10px ${barColor}99` : "none", transition: "box-shadow .4s ease" }}>
                  <div style={{
                    height: "100%", borderRadius: 999, background: barColor,
                    width: barsIn ? `${c.score}%` : "0%",
                    transition: `width .55s cubic-bezier(.22,.9,.34,1) ${i * 0.12}s`,
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


function WeightTrackerScreen({ weights, weightSeries, goalWeight, weightPace, weightProjection, onAdd, onClose, onDelete }) {
  const [inputVal, setInputVal] = useState("");
  const latest = weights.length ? [...weights].sort((a, b) => b.timestamp - a.timestamp)[0] : null;

  // Redraw once on mount, and again any time a weigh-in is added or removed
  // (not on unrelated re-renders), so the line visibly extends to the new
  // point instead of just snapping.
  const [chartsSettled, setChartsSettled] = useState(false);
  useEffect(() => {
    setChartsSettled(false);
    const t = setTimeout(() => setChartsSettled(true), 700);
    return () => clearTimeout(t);
  }, [weights.length]);

  function submit() {
    const w = num(inputVal, null);
    if (!w) return;
    onAdd(w);
    setInputVal("");
  }

  return (
    <div className="absolute inset-0 flex flex-col" style={{ background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, zIndex: 50 }}>
      <div className="flex items-center px-4" style={{ paddingTop: "calc(16px + env(safe-area-inset-top, 0px))", paddingBottom: 12 }}>
        <button onClick={onClose} className="flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: "50%", background: C.card, border: "none" }}>
          <ChevronLeft size={17} color={C.ink} />
        </button>
        <span className="ft-display flex-1 text-center" style={{ fontSize: 17, fontWeight: 700, color: C.ink, marginRight: 34 }}>Weight Tracker</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4" style={{ paddingBottom: 32 }}>
        <div className="p-5 mb-4" style={{ background: C.card, borderRadius: 24, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
          <div className="flex items-end justify-between mb-4">
            <div className="flex items-baseline gap-1.5">
              <span className="ft-display" style={{ fontSize: 34, fontWeight: 700, color: C.ink }}><AnimatedNumber value={latest ? latest.weight : 0} decimals={1} /></span>
              <span className="ft-body" style={{ fontSize: 14, color: C.inkSoft, fontWeight: 600 }}>kg</span>
              {weightProjection && (
                <span key={latest ? latest.id : "none"} className="anim-check-pop flex items-center" style={{ marginLeft: 2, animationFillMode: "backwards" }}>
                  {weightProjection.onTrack
                    ? <TrendingUp size={16} color={C.green} />
                    : <TrendingDown size={16} color={C.pink} />}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <input type="number" inputMode="decimal" value={inputVal} onChange={(e) => setInputVal(e.target.value)} placeholder="Add kg"
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
                className="ft-mono text-right" style={{ width: 74, padding: "9px 10px", borderRadius: 12, border: "none", background: C.bgBottom, color: C.ink, fontSize: 14, outline: "none" }} />
              <button onClick={submit} className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: "50%", background: C.orange, flexShrink: 0, border: "none" }}>
                <Plus size={16} color="#fff" />
              </button>
            </div>
          </div>

          {weightSeries.length === 0 ? (
            <EmptyState icon={Scale} text="Log a weigh-in to start tracking your trend." compact />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={weightSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} domain={["dataMin - 2", "dataMax + 2"]} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                  {goalWeight > 0 && (
                    <ReferenceLine y={goalWeight} stroke={C.green} strokeOpacity={chartsSettled ? 1 : 0} strokeDasharray="4 4" strokeWidth={1.5}
                      style={{ transition: "stroke-opacity .5s ease" }}
                      label={{ value: "Goal", position: "insideTopRight", fill: C.green, fontSize: 12, style: { opacity: chartsSettled ? 1 : 0, transition: "opacity .5s ease" } }} />
                  )}
                  <Line type="monotone" dataKey="weight" stroke={C.orange} strokeWidth={2} dot={makeExpandingLastDot(weightSeries.length, chartsSettled, C.orange)} isAnimationActive={!chartsSettled} animationDuration={700} animationEasing="ease-out" />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                {!weightPace ? (
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Log at least 2 weigh-ins to see a pace projection.</span>
                ) : !goalWeight ? (
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Currently {weightPace.paceKgPerWeek > 0 ? "gaining" : weightPace.paceKgPerWeek < 0 ? "losing" : "holding steady at"} {Math.abs(weightPace.paceKgPerWeek).toFixed(2)}/week. Set a goal weight in Profile to see a projection.</span>
                ) : !weightProjection ? (
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Weight has been stable — no clear pace to project from yet.</span>
                ) : weightProjection.onTrack ? (
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.green, fontWeight: 600 }}>On pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) to reach your goal in ~{weightProjection.weeks} weeks.</span>
                ) : (
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.pink, fontWeight: 600 }}>Current pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) is moving away from your goal.</span>
                )}
              </div>
            </>
          )}
        </div>

        {weights.length > 0 && (
          <div className="flex flex-col gap-2">
            <div className="ft-body px-1" style={{ fontSize: 12, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Weight history</div>
            {[...weights].sort((a, b) => b.timestamp - a.timestamp).map((w) => (
              <div key={w.id} className="flex items-center justify-between p-3 rounded-2xl" style={{ background: C.card }}>
                <span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>{fmtDate(w.date)}</span>
                <span className="ft-mono" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{w.weight} kg</span>
                <button onClick={() => onDelete(w.id)} className="p-1.5"><Trash2 size={14} color={C.pink} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Workout split editor ----------
// Edits a single named split (e.g. "Push Pull Legs") made of days, each just a
// label + an ordered list of planned exercise names. Saved immediately on every
// change. Nothing here forces a day's exercises to be logged — ExerciseForm just
// offers them as one-tap starting points; anything skipped stays empty.
function WorkoutSplitEditor({ splits, onSave }) {
  const split = (splits && splits[0]) || { id: uid(), name: "My Split", days: [] };
  const [newExerciseText, setNewExerciseText] = useState({});

  function updateSplit(next) { onSave([next, ...(splits ? splits.slice(1) : [])]); }
  function updateDay(dayId, patch) { updateSplit({ ...split, days: split.days.map((d) => (d.id === dayId ? { ...d, ...patch } : d)) }); }
  function addDay() { updateSplit({ ...split, days: [...split.days, { id: uid(), label: "New day", exercises: [] }] }); }
  function removeDay(dayId) { updateSplit({ ...split, days: split.days.filter((d) => d.id !== dayId) }); }
  function addExercise(dayId) {
    const text = (newExerciseText[dayId] || "").trim();
    if (!text) return;
    const day = split.days.find((d) => d.id === dayId);
    updateDay(dayId, { exercises: [...day.exercises, text] });
    setNewExerciseText((p) => ({ ...p, [dayId]: "" }));
  }
  function removeExercise(dayId, idx) {
    const day = split.days.find((d) => d.id === dayId);
    updateDay(dayId, { exercises: day.exercises.filter((_, i) => i !== idx) });
  }

  return (
    <div className="p-4 mb-6" style={{ background: C.card, borderRadius: 16, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
      <input value={split.name} onChange={(e) => updateSplit({ ...split, name: e.target.value })} placeholder="Split name"
        className="w-full ft-body mb-3" style={{ fontSize: 14, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none" }} />
      <div className="flex flex-col gap-3">
        {split.days.map((day) => (
          <div key={day.id} className="p-3" style={{ background: C.bgBottom, borderRadius: 12 }}>
            <div className="flex items-center justify-between mb-2 gap-2">
              <input value={day.label} onChange={(e) => updateDay(day.id, { label: e.target.value })} placeholder="Day label"
                className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink, background: "transparent", border: "none", outline: "none", flex: 1, minWidth: 0 }} />
              <button onClick={() => removeDay(day.id)} style={{ flexShrink: 0 }}><Trash2 size={14} color={C.pink} /></button>
            </div>
            {day.exercises.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {day.exercises.map((ex, i) => (
                  <div key={i} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1.5 rounded-full" style={{ background: C.card }}>
                    <span className="ft-body" style={{ fontSize: 12.5, color: C.ink }}>{ex}</span>
                    <button onClick={() => removeExercise(day.id, i)} className="flex items-center justify-center" style={{ width: 16, height: 16 }}><X size={10} color={C.inkSoft} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input value={newExerciseText[day.id] || ""} onChange={(e) => setNewExerciseText((p) => ({ ...p, [day.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") addExercise(day.id); }}
                placeholder="Add exercise" className="flex-1 ft-body" style={{ fontSize: 12, color: C.ink, background: C.card, border: "none", borderRadius: 12, padding: "7px 10px", outline: "none" }} />
              <button onClick={() => addExercise(day.id)} className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 12, background: C.orangeTint, flexShrink: 0 }}><Plus size={14} color={C.orange} /></button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addDay} className="flex items-center gap-1.5 mt-3 ft-body" style={{ color: C.blue, fontSize: 12.5, fontWeight: 600 }}><Plus size={14} /> Add day</button>
    </div>
  );
}
