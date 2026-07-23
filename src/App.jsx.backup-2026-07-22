import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  Camera, Type, Utensils, ClipboardList, BarChart3, User, Plus,
  Trash2, Loader2, TrendingUp, TrendingDown, Minus, X, Check,
  Flame, Trophy, Dumbbell, Wheat, Droplet, AlertCircle, Home, Activity, Sparkles,
  Star, Pencil, Copy, Droplets, ChevronLeft, ChevronRight, ChevronDown, CalendarDays, Gauge,
  Bell, Award, Layers, Brain, Lightbulb, Mic
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
// Weekday check on a "YYYY-MM-DD" local date string (Mon-Fri). Parses components
// manually (not `new Date(dateStr)`) to avoid that string being read as UTC midnight.
function isWeekday(dateStr) {
  const [y, m, day] = dateStr.split("-").map(Number);
  const dow = new Date(y, m - 1, day).getDay();
  return dow >= 1 && dow <= 5;
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

  return { total, summary, breakdown: weighted };
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
    model: "gemini-3.1-flash-lite"
  });

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

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  });

  return result.response.text();
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

// ---------- Haptics ----------
// Best-effort tactile feedback for save/delete actions. No-ops silently on
// devices/browsers without the Vibration API (e.g. iOS Safari, desktop).
function haptic(kind = "light") {
  try {
    if (!("vibrate" in navigator)) return;
    const patterns = { light: 12, success: [10, 40, 14], delete: [16, 30, 16] };
    navigator.vibrate(patterns[kind] ?? 12);
  } catch { /* vibration not supported/allowed — ignore */ }
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
    consistencyPct, gymDays, avgWaterL: Math.round((avgWater / 1000) * 10) / 10,
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
Gym days this ${periodLabel}: ${stats.gymDays}/${stats.periodDays}.
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
    increase: { color: C.green, bg: C.greenTint, icon: TrendingUp, label: "Grow portion" },
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

// Skeleton placeholder mirroring the NutritionLabel's shape while the AI call is
// in flight, so the layout doesn't jump once real data lands.
function NutritionSkeleton() {
  const bar = (w, h = 12) => <div style={{ width: w, height: h, borderRadius: 6, background: C.track, opacity: 0.7 }} className="skeleton-pulse" />;
  return (
    <div className="p-4 mt-3" style={{ background: C.card, border: `2px solid ${C.line}`, borderRadius: 16 }}>
      <style>{`@keyframes skeletonPulse{0%,100%{opacity:.45}50%{opacity:.9}} .skeleton-pulse{animation:skeletonPulse 1.1s ease-in-out infinite}`}</style>
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

function MacroPill({ icon: Icon, iconBg, iconColor, label, value, unit, pct }) {
  return (
    <div className="flex-1 flex flex-col items-center gap-1.5 py-3 px-2" style={{ background: C.card, borderRadius: 22, boxShadow: "0 1px 3px rgba(20,20,20,0.06)" }}>
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
      style={{ background: active ? C.ink : C.card, color: active ? C.onInk : C.inkSoft, fontSize: 12.5, fontWeight: 600 }}>
      {label}
    </button>
  );
}

function EmptyState({ text, compact, icon: Icon = Utensils }) {
  return (
    <div className="flex flex-col items-center justify-center text-center" style={{ padding: compact ? "20px 0" : "40px 0" }}>
      <div style={{
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
    <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <CalendarDays size={15} color={C.ink} />
          <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{monthLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setMonthCursor((m) => { const n = new Date(m); n.setMonth(n.getMonth() - 1); return n; })} className="p-1.5"><ChevronLeft size={16} color={C.inkSoft} /></button>
          <button onClick={() => setMonthCursor((m) => { const n = new Date(m); n.setMonth(n.getMonth() + 1); return n; })} className="p-1.5"><ChevronRight size={16} color={C.inkSoft} /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={i} className="ft-body text-center" style={{ fontSize: 10, color: C.inkSoft, fontWeight: 600 }}>{d}</div>
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
              style={{ aspectRatio: "1", borderRadius: 10, background: selected ? C.ink : "transparent" }}>
              <span className="ft-mono" style={{ fontSize: 11, color: selected ? C.onInk : isToday(d) ? C.orange : C.ink, fontWeight: isToday(d) ? 700 : 500 }}>{d}</span>
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
  const [addMode, setAddMode] = useState("photo");
  const [logsSubTab, setLogsSubTab] = useState("meals");
  const [logsDateFilter, setLogsDateFilter] = useState(null);
  const [chartsSubTab, setChartsSubTab] = useState("nutrition");
  const [chartsPeriod, setChartsPeriod] = useState("week");

  const [profile, setProfile] = useState({ name: "" });
  const [goals, setGoals] = useState({ calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, targetWeight: 0 });
  const [logs, setLogs] = useState([]);
  const [weights, setWeights] = useState([]);
  const [exerciseLogs, setExerciseLogs] = useState([]);
  const [favorites, setFavorites] = useState([]);
  const [waterLogs, setWaterLogs] = useState([]);
  const [splits, setSplits] = useState([]);
  const [dailyCoach, setDailyCoach] = useState(null); // { date, summary, suggestions }
  const [weeklyReview, setWeeklyReview] = useState(null); // { weekStart, summary, focusNextWeek, generatedAt }
  const [monthlyReview, setMonthlyReview] = useState(null); // { monthStart, summary, focusNextMonth, generatedAt }
  const [editingEntry, setEditingEntry] = useState(null);

  const loadAll = useCallback(async () => {
    const [p, g, l, w, e, f, wa, sp, dc, wr, mr] = await Promise.all([
      loadKey("profile", { name: "" }),
      loadKey("goals", { calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, targetWeight: 0 }),
      loadKey("meal-logs", []),
      loadKey("weight-logs", []),
      loadKey("exercise-logs", []),
      loadKey("favorite-meals", []),
      loadKey("water-logs", []),
      loadKey("workout-splits", DEFAULT_SPLITS),
      loadKey("daily-coach", null),
      loadKey("weekly-review", null),
      loadKey("monthly-review", null),
    ]);
    setProfile(p); setGoals({ calories: 2000, protein: 120, carbs: 220, fat: 65, fiber: 28, water: 2000, targetWeight: 0, ...g }); setLogs(l); setWeights(w); setExerciseLogs(e); setFavorites(f); setWaterLogs(wa); setSplits(sp); setDailyCoach(dc); setWeeklyReview(wr); setMonthlyReview(mr); setReady(true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);


  // ---------- Pull-to-refresh ----------
  // Touch-driven, no external library: tracks a downward drag that only starts
  // when the scroll container is already at the top, applies resistance, and
  // reloads persisted data past the threshold.
  const scrollRef = useRef(null);
  const pullStartY = useRef(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const PULL_THRESHOLD = 64;
  const onPullTouchStart = (e) => {
    pullStartY.current = scrollRef.current && scrollRef.current.scrollTop === 0 && !refreshing ? e.touches[0].clientY : null;
  };
  const onPullTouchMove = (e) => {
    if (pullStartY.current == null) return;
    const delta = e.touches[0].clientY - pullStartY.current;
    if (delta > 0) setPullDistance(Math.min(delta * 0.45, 80));
  };
  const onPullTouchEnd = async () => {
    if (pullStartY.current == null) return;
    pullStartY.current = null;
    if (pullDistance > PULL_THRESHOLD) {
      setRefreshing(true);
      haptic("light");
      await loadAll();
      setRefreshing(false);
    }
    setPullDistance(0);
  };

  const todayLogs = useMemo(() => logs.filter((l) => l.date === todayStr()), [logs]);
  const todayExerciseLogs = useMemo(() => exerciseLogs.filter((e) => e.date === todayStr()), [exerciseLogs]);
  const todayTotals = useMemo(() => todayLogs.reduce((acc, l) => ({
    calories: acc.calories + num(l.calories), protein: acc.protein + num(l.protein_g),
    carbs: acc.carbs + num(l.carbs_g), fat: acc.fat + num(l.fat_g), fiber: acc.fiber + num(l.fiber_g),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }), [todayLogs]);

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

  async function persistLogs(next) { setLogs(next); await saveKey("meal-logs", next); }
  async function persistWeights(next) { setWeights(next); await saveKey("weight-logs", next); }
  async function persistWater(next) { setWaterLogs(next); await saveKey("water-logs", next); }
  async function addWater(ml) {
    haptic("light");
    await persistWater([{ id: uid(), date: todayStr(), ml, timestamp: Date.now() }, ...waterLogs]);
  }
  async function removeLastWater() {
    const idx = waterLogs.findIndex((w) => w.date === todayStr());
    if (idx === -1) return;
    haptic("light");
    await persistWater(waterLogs.filter((_, i) => i !== idx));
  }
  async function persistGoals(next) { setGoals(next); await saveKey("goals", next); }
  async function persistProfile(next) { setProfile(next); await saveKey("profile", next); }
  async function persistExercise(next) { setExerciseLogs(next); await saveKey("exercise-logs", next); }
  async function persistSplits(next) { setSplits(next); await saveKey("workout-splits", next); }
  async function persistDailyCoach(next) { setDailyCoach(next); await saveKey("daily-coach", next); }
  async function persistWeeklyReview(next) { setWeeklyReview(next); await saveKey("weekly-review", next); }
  async function persistMonthlyReview(next) { setMonthlyReview(next); await saveKey("monthly-review", next); }
  async function persistFavorites(next) { setFavorites(next); await saveKey("favorite-meals", next); }

  async function deleteLog(id) { haptic("delete"); await persistLogs(logs.filter((l) => l.id !== id)); }
  async function deleteExercise(id) { haptic("delete"); await persistExercise(exerciseLogs.filter((e) => e.id !== id)); }

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
  const insights = useMemo(() => generateInsights(logs, exerciseLogs, goals), [logs, exerciseLogs, goals]);
  const periodSummary = useMemo(() => computePeriodSummary(logs, chartsPeriod === "week" ? 7 : 30), [logs, chartsPeriod]);
  const todayWater = useMemo(() => waterLogs.filter((w) => w.date === todayStr()).reduce((s, w) => s + num(w.ml), 0), [waterLogs]);
  const nutritionScore = useMemo(() => computeNutritionScore({ todayTotals, todayLogs, goals, waterMl: todayWater }), [todayTotals, todayLogs, goals, todayWater]);
  const microSummary = useMemo(() => computeMicronutrientSummary(todayLogs, goals), [todayLogs, goals]);
  const weeklyAchievement = useMemo(() => computeWeeklyAchievement(logs, goals), [logs, goals]);
  const mealDates = useMemo(() => new Set(logs.map((l) => l.date)), [logs]);
  const exerciseDates = useMemo(() => new Set(exerciseLogs.map((e) => e.date)), [exerciseLogs]);
  const personalRecords = useMemo(() => computePersonalRecords(exerciseLogs), [exerciseLogs]);

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
    [todayTotals, todayLogs, goals, todayWater, nowTick, dismissedNotifications]
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

  if (!ready) return <div className="flex items-center justify-center" style={{ height: 700, background: C.bgTop }}><Loader2 className="animate-spin" size={22} color={C.orange} /></div>;

  const trimmedName = profile.name ? profile.name.trim() : "";
  const initial = trimmedName ? trimmedName[0].toUpperCase() : "U";
  const eatenPct = goals.calories > 0 ? (todayTotals.calories / goals.calories) * 100 : 0;
  const remaining = Math.max(0, Math.round(goals.calories - todayTotals.calories));

  return (
    <div className="flex flex-col relative" style={{ height: 700, maxHeight: "100vh", background: `linear-gradient(180deg, ${C.bgTop} 0%, ${C.bgBottom} 100%)`, overflow: "hidden" }}>
            <div ref={scrollRef} onTouchStart={onPullTouchStart} onTouchMove={onPullTouchMove} onTouchEnd={onPullTouchEnd}
              className="flex-1 overflow-y-auto px-4 pt-5" style={{ paddingBottom: 90 }}>

              {(pullDistance > 0 || refreshing) && (
                <div className="flex items-center justify-center" style={{ height: refreshing ? 40 : pullDistance, transition: refreshing ? "height .2s ease" : "none", overflow: "hidden" }}>
                  <Loader2 size={18} color={C.orange} className={refreshing || pullDistance > PULL_THRESHOLD ? "animate-spin" : ""}
                    style={{ transform: refreshing ? undefined : `rotate(${pullDistance * 3}deg)`, opacity: Math.min(1, pullDistance / PULL_THRESHOLD) }} />
                </div>
              )}

        <div className="flex items-center justify-between mb-5" style={{ position: "relative" }}>
          <div className="flex items-center gap-3">
            <Avatar initial={initial} />
            <div>
              <div className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft, fontWeight: 500 }}>{greeting()}</div>
              <input value={profile.name} onChange={(e) => persistProfile({ ...profile, name: e.target.value })} placeholder="Add your name"
                className="ft-display" style={{ fontSize: 19, fontWeight: 700, color: profile.name ? C.ink : C.inkSoft, background: "transparent", border: "none", outline: "none", width: "100%" }} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setNotifOpen((o) => !o)} className="relative flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: "50%", background: C.card }}>
              <Bell size={17} color={C.ink} />
              {smartNotifications.length > 0 && (
                <div style={{ position: "absolute", top: 6, right: 7, width: 8, height: 8, borderRadius: "50%", background: C.pink, border: `1.5px solid ${C.card}` }} />
              )}
            </button>
            <span className="ft-display" style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Nourish</span>
          </div>
          {notifOpen && (
            <div className="absolute" style={{ top: 44, right: 0, width: 280, zIndex: 40, background: C.card, borderRadius: 18, boxShadow: "0 10px 30px rgba(20,20,20,0.2)", padding: 12 }}>
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>Notifications</span>
                <button onClick={() => setNotifOpen(false)}><X size={15} color={C.inkSoft} /></button>
              </div>
              {smartNotifications.length === 0 ? (
                <div className="py-4 text-center ft-body" style={{ fontSize: 12, color: C.inkSoft }}>You're all caught up.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {smartNotifications.map((n) => (
                    <div key={n.id} className="flex items-start gap-2 p-2.5" style={{ background: n.bg, borderRadius: 14 }}>
                      <n.icon size={14} color={n.color} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span className="ft-body flex-1" style={{ fontSize: 12, color: C.ink, lineHeight: 1.35 }}>{n.text}</span>
                      <button onClick={() => setDismissedNotifications((d) => [...d, n.id])} style={{ flexShrink: 0 }}><X size={12} color={C.inkSoft} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
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
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.greenTint, display: "flex", alignItems: "center", justifyContent: "center" }}><ClipboardList size={16} color={C.green} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{todayLogs.length}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>meals logged</div></div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trophy size={16} color={C.pink} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{streak}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>day streak</div></div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2.5 mb-4">
              <MacroPill icon={Dumbbell} iconBg={C.purpleTint} iconColor={C.purple} label="Protein" value={Math.round(todayTotals.protein)} unit="g" pct={goals.protein > 0 ? (todayTotals.protein / goals.protein) * 100 : 0} />
              <MacroPill icon={Wheat} iconBg={C.tanTint} iconColor={C.tan} label="Carbs" value={Math.round(todayTotals.carbs)} unit="g" pct={goals.carbs > 0 ? (todayTotals.carbs / goals.carbs) * 100 : 0} />
              <MacroPill icon={Droplet} iconBg={C.pinkTint} iconColor={C.pink} label="Fat" value={Math.round(todayTotals.fat)} unit="g" pct={goals.fat > 0 ? (todayTotals.fat / goals.fat) * 100 : 0} />
            </div>

            <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 22, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center gap-3">
                <div style={{ width: 46, height: 46, borderRadius: "50%", background: nutritionScore.total >= 80 ? C.greenTint : nutritionScore.total >= 55 ? C.tanTint : C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Gauge size={20} color={nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1.5">
                    <span className="ft-display" style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Today's Nutrition Score</span>
                    <span className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color: nutritionScore.total >= 80 ? C.green : nutritionScore.total >= 55 ? C.tan : C.pink }}>{nutritionScore.total}/100</span>
                  </div>
                  <div className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4, marginTop: 1 }}>{nutritionScore.summary}</div>
                </div>
              </div>
            </div>

            <div className="p-4 mb-6" style={{ background: C.card, borderRadius: 22, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2">
                  <Droplets size={16} color={C.blue} />
                  <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Water</span>
                </div>
                <span className="ft-mono" style={{ fontSize: 12, color: C.inkSoft }}>{(todayWater / 1000).toFixed(2).replace(/\.?0+$/, "") || 0}L / {(goals.water / 1000).toFixed(1)}L</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 flex gap-1">
                  {Array.from({ length: Math.max(1, Math.round(goals.water / 250)) }).map((_, i) => (
                    <div key={i} style={{ flex: 1, height: 10, borderRadius: 4, background: i < Math.round(todayWater / 250) ? C.blue : C.track }} />
                  ))}
                </div>
                <button onClick={removeLastWater} disabled={todayWater === 0} className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: "50%", background: C.bgBottom, opacity: todayWater === 0 ? 0.4 : 1, flexShrink: 0 }}><Minus size={14} color={C.inkSoft} /></button>
                <button onClick={() => addWater(250)} className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: "50%", background: C.blueTint, flexShrink: 0 }}><Plus size={14} color={C.blue} /></button>
              </div>
            </div>

            <div className="p-4 mb-6" style={{ background: C.card, borderRadius: 22, boxShadow: "0 2px 10px rgba(20,20,20,0.06)" }}>
              <div className="flex items-center gap-2 mb-2.5">
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.purpleTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Brain size={15} color={C.purple} />
                </div>
                <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>AI Daily Coach</span>
              </div>
              {coachLoading ? (
                <div className="flex items-center gap-2 py-2">
                  <Loader2 size={14} className="animate-spin" color={C.purple} />
                  <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Reviewing today's log…</span>
                </div>
              ) : dailyCoach && dailyCoach.date === todayStr() ? (
                <>
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>{dailyCoach.summary}</div>
                  <div className="flex flex-col gap-2 mb-2">
                    {dailyCoach.suggestions.map((s, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Lightbulb size={13} color={C.tan} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span className="ft-body" style={{ fontSize: 12, color: C.inkSoft, lineHeight: 1.4 }}>{s}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={generateDailyCoach} className="ft-body" style={{ fontSize: 11.5, color: C.purple, fontWeight: 600 }}>Refresh</button>
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
              {coachError && <div className="ft-body mt-2" style={{ fontSize: 11.5, color: C.pink }}>{coachError}</div>}
            </div>
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
              <Chip active={logsSubTab === "meals"} onClick={() => setLogsSubTab("meals")} label={`Meals (${logs.length})`} />
              <Chip active={logsSubTab === "exercise"} onClick={() => setLogsSubTab("exercise")} label={`Exercise (${exerciseLogs.length})`} />
            </div>
            {logsSubTab === "meals" ? (() => {
              const visibleMeals = logsDateFilter ? logs.filter((l) => l.date === logsDateFilter) : logs;
              if (visibleMeals.length === 0) {
                return <EmptyState icon={Utensils} text={logsDateFilter ? "No meals logged on this day." : "Nothing logged yet. Tap the orange + button to add your first meal."} />;
              }
              const renderMeal = (l) => (
                <div className="flex items-center justify-between p-3.5" style={{ background: C.card, borderRadius: 18, boxShadow: "0 1px 4px rgba(20,20,20,0.05)", height: "100%", boxSizing: "border-box" }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div style={{ width: 38, height: 38, borderRadius: "50%", background: C.orangeTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Utensils size={15} color={C.orange} /></div>
                    <div className="min-w-0">
                      <div className="ft-body" style={{ fontSize: 14, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.food_name}</div>
                      <div className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>{fmtDateTime(l.timestamp)} · {Math.round(l.calories)} kcal · P{Math.round(l.protein_g)} C{Math.round(l.carbs_g)} F{Math.round(l.fat_g)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button onClick={() => toggleFavorite(l)} className="p-2" title="Favorite">
                      <Star size={14} color={C.tan} fill={favorites.some((f) => (f.food_name || "").trim().toLowerCase() === (l.food_name || "").trim().toLowerCase()) ? C.tan : "none"} />
                    </button>
                    <button onClick={() => openEdit("meal", l)} className="p-2" title="Edit"><Pencil size={14} color={C.inkSoft} /></button>
                    <button onClick={() => duplicateLog(l)} className="p-2" title="Duplicate"><Copy size={14} color={C.inkSoft} /></button>
                    <button onClick={() => deleteLog(l.id)} className="p-2" title="Delete"><Trash2 size={14} color={C.pink} /></button>
                  </div>
                </div>
              );
              // Hundreds of entries render efficiently via windowing; short lists use
              // the normal flow layout so they don't get boxed into a fixed height.
              if (visibleMeals.length > VIRTUALIZE_THRESHOLD) {
                return <VirtualList items={visibleMeals} itemHeight={66} gap={10} height={480} renderItem={renderMeal} />;
              }
              return <div className="flex flex-col gap-2.5">{visibleMeals.map((l) => <div key={l.id}>{renderMeal(l)}</div>)}</div>;
            })() : (() => {
              const visibleExercise = logsDateFilter ? exerciseLogs.filter((e) => e.date === logsDateFilter) : exerciseLogs;
              if (visibleExercise.length === 0) {
                return <EmptyState icon={Dumbbell} text={logsDateFilter ? "No workouts logged on this day." : "No workouts logged yet. Tap the orange + button and choose Exercise."} />;
              }
              return (
                <div className="flex flex-col gap-2.5">
                  {!logsDateFilter && Object.keys(personalRecords).length > 0 && (
                    <div className="p-3.5 mb-1" style={{ background: C.card, borderRadius: 18, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                      <div className="flex items-center gap-1.5 mb-2.5">
                        <Award size={14} color={C.tan} />
                        <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Personal records</span>
                      </div>
                      <div className="flex gap-2" style={{ overflowX: "auto" }}>
                        {Object.values(personalRecords).map((r) => (
                          <div key={r.name} className="flex-shrink-0 px-3 py-2" style={{ background: C.tanTint, borderRadius: 14, minWidth: 110 }}>
                            <div className="ft-body" style={{ fontSize: 11, color: C.ink, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{r.name}</div>
                            <div className="ft-mono" style={{ fontSize: 13, fontWeight: 700, color: C.tan }}>{r.weight}kg × {r.reps}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {visibleExercise.map((e) => {
                    const volume = e.type === "strength" ? e.sets.reduce((s, x) => s + num(x.weight) * num(x.reps), 0) : 0;
                    const overload = computeProgressiveOverload(e, exerciseLogs.filter((x) => x.timestamp < e.timestamp));
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
                              {overload && overload.isPR && (
                                <div className="flex items-center gap-1 mt-1"><Award size={11} color={C.tan} /><span className="ft-body" style={{ fontSize: 10.5, color: C.tan, fontWeight: 700 }}>New PR</span></div>
                              )}
                              {overload && !overload.isPR && !overload.isNew && overload.deltaWeight !== 0 && (
                                <div className="flex items-center gap-1 mt-1">
                                  {overload.deltaWeight > 0 ? <TrendingUp size={11} color={C.green} /> : <TrendingDown size={11} color={C.pink} />}
                                  <span className="ft-body" style={{ fontSize: 10.5, color: overload.deltaWeight > 0 ? C.green : C.pink, fontWeight: 600 }}>
                                    {overload.deltaWeight > 0 ? "+" : ""}{Math.round(overload.deltaWeight * 10) / 10}kg top set vs last time
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={() => openEdit("exercise", e)} className="p-2" title="Edit"><Pencil size={14} color={C.inkSoft} /></button>
                            <button onClick={() => duplicateExercise(e)} className="p-2" title="Duplicate"><Copy size={14} color={C.inkSoft} /></button>
                            <button onClick={() => deleteExercise(e.id)} className="p-2" title="Delete"><Trash2 size={14} color={C.pink} /></button>
                          </div>
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
              );
            })()}
          </div>
        )}

        {tab === "charts" && (
          <div>
            {insights.length > 0 && (
              <div className="flex flex-col gap-2 mb-4">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-3" style={{ background: ins.bg, borderRadius: 16 }}>
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
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Calories vs. goal</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={last14}>
                      <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                      <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={30} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
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
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Line type="monotone" dataKey="protein" stroke={C.purple} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="carbs" stroke={C.tan} strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="fat" stroke={C.pink} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="p-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Weight</span>
                    {goals.targetWeight > 0 && <span className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>Goal: {goals.targetWeight}</span>}
                  </div>
                  {weightSeries.length === 0 ? <EmptyState text="Log a weight entry in Profile to see your trend." compact /> : (
                    <>
                      <ResponsiveContainer width="100%" height={150}>
                        <LineChart data={weightSeries}>
                          <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                          <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} />
                          <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} domain={["dataMin - 2", "dataMax + 2"]} />
                          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                          {goals.targetWeight > 0 && (
                            <ReferenceLine y={goals.targetWeight} stroke={C.green} strokeDasharray="4 4" strokeWidth={1.5}
                              label={{ value: "Goal", position: "insideTopRight", fill: C.green, fontSize: 10 }} />
                          )}
                          <Line type="monotone" dataKey="weight" stroke={C.ink} strokeWidth={2} dot={{ r: 3 }} />
                        </LineChart>
                      </ResponsiveContainer>
                      <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
                        {!weightPace ? (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>Log at least 2 weigh-ins to see a pace projection.</span>
                        ) : !goals.targetWeight ? (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>Currently {weightPace.paceKgPerWeek > 0 ? "gaining" : weightPace.paceKgPerWeek < 0 ? "losing" : "holding steady at"} {Math.abs(weightPace.paceKgPerWeek).toFixed(2)}/week. Set a goal weight in Profile to see a projection.</span>
                        ) : !weightProjection ? (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>Weight has been stable — no clear pace to project from yet.</span>
                        ) : weightProjection.onTrack ? (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.green, fontWeight: 600 }}>On pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) to reach your goal in ~{weightProjection.weeks} weeks.</span>
                        ) : (
                          <span className="ft-body" style={{ fontSize: 11.5, color: C.pink, fontWeight: 600 }}>Current pace ({weightPace.paceKgPerWeek > 0 ? "+" : ""}{weightPace.paceKgPerWeek.toFixed(2)}/week) is moving away from your goal.</span>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="p-4 mt-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-3" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Micronutrients today</div>
                  {todayLogs.length === 0 ? <EmptyState text="Log a meal to see today's micronutrient breakdown." compact /> : (
                    <div className="flex flex-col gap-2.5">
                      {microSummary.map((m) => (
                        <div key={m.key}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="ft-body" style={{ fontSize: 12, color: C.ink, fontWeight: 500 }}>{m.label}</span>
                            <span className="ft-mono" style={{ fontSize: 11.5, color: C.inkSoft }}>{m.value}{m.unit}</span>
                          </div>
                          <div style={{ height: 6, borderRadius: 3, background: C.track, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${clamp(m.pct, 0, 100)}%`, background: m.capIsLimit && m.pct > 100 ? C.pink : m.color, borderRadius: 3, transition: "width .4s ease" }} />
                          </div>
                        </div>
                      ))}
                      <div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft, marginTop: 2 }}>Calcium, iron, B12, vitamin D & potassium are estimated from the AI's per-meal %DV values.</div>
                    </div>
                  )}
                </div>
              </>
            ) : chartsSubTab === "exercise" ? (
              <>
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="ft-body mb-2" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Training volume (kg/day)</div>
                  {exerciseLogs.length === 0 ? <EmptyState text="Log a workout to see your volume trend." compact /> : (
                    <ResponsiveContainer width="100%" height={150}>
                      <BarChart data={last14}>
                        <CartesianGrid strokeDasharray="3 3" stroke={C.line} vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={{ stroke: C.line }} tickLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: C.inkSoft }} axisLine={false} tickLine={false} width={34} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
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
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, background: C.card, color: C.ink }} labelStyle={{ color: C.ink, fontWeight: 600, marginBottom: 4 }} />
                        <Bar dataKey="burned" fill={C.pink} radius={[3, 3, 0, 0]} />
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
                  <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.blueTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <BarChart3 size={15} color={C.blue} />
                      </div>
                      <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Weekly AI Review</span>
                    </div>
                    {weeklyReviewLoading ? (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 size={14} className="animate-spin" color={C.blue} />
                        <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Analyzing this week…</span>
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
                        <button onClick={generateWeeklyReview} className="ft-body" style={{ fontSize: 11.5, color: C.blue, fontWeight: 600 }}>Refresh</button>
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
                    {weeklyReviewError && <div className="ft-body mt-2" style={{ fontSize: 11.5, color: C.pink }}>{weeklyReviewError}</div>}
                  </div>
                ) : (
                  <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <div style={{ width: 30, height: 30, borderRadius: "50%", background: C.purpleTint, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <CalendarDays size={15} color={C.purple} />
                      </div>
                      <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>Monthly AI Review</span>
                    </div>
                    {monthlyReviewLoading ? (
                      <div className="flex items-center gap-2 py-2">
                        <Loader2 size={14} className="animate-spin" color={C.purple} />
                        <span className="ft-body" style={{ fontSize: 12.5, color: C.inkSoft }}>Analyzing this month…</span>
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
                        <button onClick={generateMonthlyReview} className="ft-body" style={{ fontSize: 11.5, color: C.purple, fontWeight: 600 }}>Refresh</button>
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
                    {monthlyReviewError && <div className="ft-body mt-2" style={{ fontSize: 11.5, color: C.pink }}>{monthlyReviewError}</div>}
                  </div>
                )}
                <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink }}>Avg calories/day</span>
                    <TrendArrow trend={periodSummary.calorieTrend} />
                  </div>
                  <div className="ft-display" style={{ fontSize: 30, fontWeight: 700, color: C.ink }}>{periodSummary.avgCalories}<span className="ft-body" style={{ fontSize: 13, color: C.inkSoft, fontWeight: 500 }}> / {goals.calories} kcal</span></div>
                  <div className="ft-body" style={{ fontSize: 11, color: C.inkSoft, marginTop: 2 }}>{periodSummary.daysLogged} of {chartsPeriod === "week" ? 7 : 30} days logged</div>
                </div>
                <div className="flex gap-2.5 mb-4">
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 18 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 11, color: C.inkSoft, fontWeight: 600 }}>Protein</span><TrendArrow trend={periodSummary.proteinTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.purple }}>{periodSummary.avgProtein}g</div>
                  </div>
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 18 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 11, color: C.inkSoft, fontWeight: 600 }}>Carbs</span><TrendArrow trend={periodSummary.carbsTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.tan }}>{periodSummary.avgCarbs}g</div>
                  </div>
                  <div className="flex-1 p-3" style={{ background: C.card, borderRadius: 18 }}>
                    <div className="flex items-center justify-between mb-1"><span className="ft-body" style={{ fontSize: 11, color: C.inkSoft, fontWeight: 600 }}>Fat</span><TrendArrow trend={periodSummary.fatTrend} size={11} /></div>
                    <div className="ft-mono" style={{ fontSize: 16, fontWeight: 700, color: C.pink }}>{periodSummary.avgFat}g</div>
                  </div>
                </div>
                <div className="flex gap-2.5 mb-4">
                  <div className="flex-1 flex items-center gap-2.5 p-3.5" style={{ background: C.card, borderRadius: 18 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.pinkTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trophy size={16} color={C.pink} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{streak}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>current streak</div></div>
                  </div>
                  <div className="flex-1 flex items-center gap-2.5 p-3.5" style={{ background: C.card, borderRadius: 18 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: C.tanTint, display: "flex", alignItems: "center", justifyContent: "center" }}><Trophy size={16} color={C.tan} /></div>
                    <div><div className="ft-display" style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{bestStreak}</div><div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>best streak</div></div>
                  </div>
                </div>

                <div className="p-4" style={{ background: C.card, borderRadius: 20, boxShadow: "0 1px 4px rgba(20,20,20,0.05)" }}>
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
    onAddWeight={async (w) => {
      const entry = {
        id: uid(),
        date: todayStr(),
        timestamp: Date.now(),
        weight: w,
      };
      haptic("success");
      await persistWeights([
        entry,
        ...weights.filter((x) => x.date !== todayStr()),
      ]);
    }}
    onDeleteWeight={async (id) => {
      haptic("delete");
      await persistWeights(weights.filter((w) => w.id !== id));
    }}
    darkMode={darkMode}
    setDarkMode={setDarkMode}
    splits={splits}
    onSaveSplits={persistSplits}
  />
)}

      </div>

      <div className="absolute left-4 right-4 flex items-center" style={{
        background: C.card, borderRadius: 30, height: 64,
        bottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
        boxShadow: "0 10px 30px rgba(20,20,20,0.16), 0 2px 8px rgba(20,20,20,0.07)",
      }}>
        <NavBtn active={tab === "home"} onClick={() => setTab("home")} icon={Home} label="Home" />
        <NavBtn active={tab === "logs"} onClick={() => setTab("logs")} icon={ClipboardList} label="Logs" />
        <div style={{ width: 60 }} />
        <NavBtn active={tab === "charts"} onClick={() => setTab("charts")} icon={BarChart3} label="Insights" />
        <NavBtn active={tab === "profile"} onClick={() => setTab("profile")} icon={User} label="Profile" />
      </div>
      <button onClick={() => openAdd("meal", "photo")} className="absolute flex items-center justify-center"
        style={{
          left: "50%", transform: "translateX(-50%)",
          bottom: "calc(46px + env(safe-area-inset-bottom, 0px))",
          width: 52, height: 52, borderRadius: "50%",
          background: `linear-gradient(135deg, ${C.orange}, ${C.orangeDeep})`,
          boxShadow: "0 8px 18px rgba(238,108,55,0.4), 0 2px 6px rgba(238,108,55,0.3)",
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
            setShowAdd(false); setEditingEntry(null);
          }}
          onSaveExercise={async (entry) => {
            const exists = exerciseLogs.some((x) => x.id === entry.id);
            const next = exists ? exerciseLogs.map((x) => (x.id === entry.id ? entry : x)) : [entry, ...exerciseLogs];
            await persistExercise(next);
            haptic("success");
            setShowAdd(false); setEditingEntry(null);
          }}
        />
      )}
    </div>
  );
}

// ---------- Add Log Sheet (Meal or Exercise) ----------
function AddLogSheet({ initialLogType, initialMode, goals, todayTotals, todayLogs, exerciseLogs, favorites, recentMeals, onToggleFavorite, splits, editingEntry, onClose, onSaveMeal, onSaveExercise }) {
  const [logType, setLogType] = useState(initialLogType);
  const isEditing = !!editingEntry;

  return (
    <div className="absolute inset-0 flex flex-col justify-end" style={{ background: "rgba(21,23,27,0.4)" }} onClick={onClose}>
      <div className="flex flex-col" style={{ background: C.bgBottom, borderRadius: "28px 28px 0 0", maxHeight: "90%", boxShadow: "0 -8px 30px rgba(0,0,0,0.2)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="ft-display" style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{isEditing ? (logType === "meal" ? "Edit meal" : "Edit workout") : "Add a log"}</span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: "50%", background: C.card, display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} color={C.ink} /></button>
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

const EMPTY_MEAL = { food_name: "", estimated_portion: "", calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0, sugar_g: 0, sodium_mg: 0, micronutrients: [], confidence: "manual", portion_verdict: null, portion_change_percent: 0, portion_guidance: "" };

function MealForm({ initialMode, goals, todayTotals, todayLogs, onSave, favorites, recentMeals, onToggleFavorite, editingEntry }) {
  const [mode, setMode] = useState(initialMode === "manual" ? "text" : initialMode);
  const [imagePreview, setImagePreview] = useState(null);
  const [description, setDescription] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [advising, setAdvising] = useState(false);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(() => {
    if (editingEntry) return { ...editingEntry };
    return initialMode === "manual" ? { ...EMPTY_MEAL } : null;
  });
  const [photoInputId] = useState(() => "meal-photo-" + uid());
  const [compressing, setCompressing] = useState(false);

  async function handleImagePick(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    setError(null); setPending(null); setCompressing(true);
    try {
      const { b64, mediaType } = await compressImageFile(file);
      setImagePreview({ b64, mediaType });
    } catch {
      // Compression failed (unsupported format, canvas error, etc.) — fall back
      // to sending the original file uncompressed rather than blocking the log.
      const b64 = await fileToBase64(file);
      setImagePreview({ b64, mediaType: file.type || "image/jpeg" });
    } finally {
      setCompressing(false);
    }
  }

  async function analyze(overrideDescription) {
    const descriptionToUse = overrideDescription != null ? overrideDescription : description;
    setError(null); setPending(null);
    if (mode === "photo" && !imagePreview) { setError("Add a photo first."); return; }
    if (mode === "text" && descriptionToUse.trim().length < 2) { setError("Describe what you ate first."); return; }
    setAnalyzing(true);
    try {
      const promptText = buildMealPrompt({ mode, description: descriptionToUse, goals, todayTotals, todayLogs });
      const blocks = mode === "photo"
        ? [{ type: "image", source: { type: "base64", media_type: imagePreview.mediaType, data: imagePreview.b64 } }, { type: "text", text: promptText }]
        : [{ type: "text", text: promptText }];
      const raw = await callGemini(blocks);
      const parsed = parseJSON(raw);
      const estimatedPortion = parsed.estimated_portion || "";
      setPending({
        food_name: parsed.food_name || (mode === "text" ? descriptionToUse : "Logged meal"),
        estimated_portion: estimatedPortion,
        calories: num(parsed.calories), protein_g: num(parsed.protein_g), carbs_g: num(parsed.carbs_g), fat_g: num(parsed.fat_g),
        fiber_g: num(parsed.fiber_g), sugar_g: num(parsed.sugar_g), sodium_mg: num(parsed.sodium_mg),
        micronutrients: Array.isArray(parsed.micronutrients) ? parsed.micronutrients : [],
        confidence: parsed.confidence || "medium",
        portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent),
        portion_guidance: parsed.portion_guidance || "",
      });
      setLastCalculatedPortion(estimatedPortion);
    } catch (e) {
      setError((e && e.message ? e.message : "Couldn't analyze that meal") + " — enter it manually below.");
      setPending({ ...EMPTY_MEAL, food_name: mode === "text" ? descriptionToUse : "Logged meal" });
      setLastCalculatedPortion("");
    } finally { setAnalyzing(false); }
  }

  // ---------- Natural voice logging ----------
  // Uses the browser's built-in speech recognition (no API/network cost of its
  // own) to transcribe spoken food descriptions, then feeds the transcript
  // straight into the same Gemini meal-analysis call used for typed text — so
  // "2 rotis, one bowl dal, 100g paneer" is understood and logged as one meal
  // without the user typing or splitting it into separate entries.
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef(null);
  const speechSupported = typeof window !== "undefined" && !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  function toggleVoiceInput() {
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
      if (event.error !== "no-speech" && event.error !== "aborted") setError("Couldn't hear that — try again or type instead.");
    };
    recognition.onend = () => {
      setListening(false);
      const transcript = finalTranscript.trim();
      if (transcript.length >= 2) analyze(transcript);
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }
  useEffect(() => () => { recognitionRef.current && recognitionRef.current.stop(); }, []);

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
  const [recalculating, setRecalculating] = useState(false);
  const portionIsStale = !!pending && pending.estimated_portion !== lastCalculatedPortion;

  function updateField(key, value) { setPending((p) => ({ ...p, [key]: key === "food_name" || key === "estimated_portion" ? value : num(value) })); }

  async function recalculateFromPortion() {
    if (!pending || !pending.food_name) { setError("Give the meal a name first."); return; }
    setError(null); setRecalculating(true);
    try {
      const description2 = `${pending.food_name}${pending.estimated_portion ? ` — portion: ${pending.estimated_portion}` : ""}`;
      const promptText = buildMealPrompt({ mode: "text", description: description2, goals, todayTotals, todayLogs });
      const raw = await callGemini([{ type: "text", text: promptText }]);
      const parsed = parseJSON(raw);
      setPending((p) => ({
        ...p,
        estimated_portion: parsed.estimated_portion || p.estimated_portion,
        calories: num(parsed.calories), protein_g: num(parsed.protein_g), carbs_g: num(parsed.carbs_g), fat_g: num(parsed.fat_g),
        fiber_g: num(parsed.fiber_g), sugar_g: num(parsed.sugar_g), sodium_mg: num(parsed.sodium_mg),
        micronutrients: Array.isArray(parsed.micronutrients) ? parsed.micronutrients : p.micronutrients,
        confidence: parsed.confidence || p.confidence,
        portion_verdict: parsed.portion_verdict || "keep", portion_change_percent: num(parsed.portion_change_percent),
        portion_guidance: parsed.portion_guidance || "",
      }));
      setLastCalculatedPortion(parsed.estimated_portion || pending.estimated_portion);
    } catch (e) {
      setError(e && e.message ? e.message : "Couldn't recalculate nutrition for that portion.");
    } finally { setRecalculating(false); }
  }

  async function save() {
    if (!pending || !pending.food_name) { setError("Give the meal a name."); return; }
    await onSave({
      id: editingEntry ? editingEntry.id : uid(),
      date: editingEntry ? editingEntry.date : todayStr(),
      timestamp: editingEntry ? editingEntry.timestamp : Date.now(),
      source: editingEntry ? editingEntry.source : mode,
      ...pending,
    });
  }

  function quickLog(meal) {
    onSave({
      id: uid(), date: todayStr(), timestamp: Date.now(), source: "quick",
      food_name: meal.food_name, estimated_portion: meal.estimated_portion || "",
      calories: num(meal.calories), protein_g: num(meal.protein_g), carbs_g: num(meal.carbs_g), fat_g: num(meal.fat_g),
      fiber_g: num(meal.fiber_g), sugar_g: num(meal.sugar_g), sodium_mg: num(meal.sodium_mg),
      micronutrients: Array.isArray(meal.micronutrients) ? meal.micronutrients : [],
      confidence: meal.confidence || "manual",
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
              <div className="ft-body mb-1.5" style={{ fontSize: 11.5, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Quick log</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {quickPicks.map((m, i) => (
                  <div key={m.id || i} className="flex flex-col gap-1.5 p-2.5 flex-shrink-0" style={{ background: C.card, borderRadius: 14, minWidth: 128, border: `1px solid ${C.line}` }}>
                    <button onClick={() => quickLog(m)} className="text-left">
                      <div className="ft-body" style={{ fontSize: 12.5, fontWeight: 600, color: C.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>{m.food_name}</div>
                      <div className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>{Math.round(num(m.calories))} kcal</div>
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
          </div>
          {mode === "photo" ? (
            <div className="mb-3">
              <input id={photoInputId} type="file" accept="image/*" capture="environment" onChange={handleImagePick} className="hidden" />
              {compressing ? (
                <div className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl" style={{ border: `2px dashed ${C.track}`, background: C.card }}>
                  <Loader2 size={22} color={C.orange} className="animate-spin" /><span className="ft-body" style={{ fontSize: 13, color: C.inkSoft }}>Optimizing photo…</span>
                </div>
              ) : imagePreview ? (
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
            <div className="relative mb-3">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 2 rotis, one bowl dal, 100g paneer"
                className="w-full p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 14, minHeight: 90, resize: "none", outline: "none", paddingRight: 46 }} />
              {speechSupported && (
                <button onClick={toggleVoiceInput} type="button" className="absolute flex items-center justify-center" title={listening ? "Stop listening" : "Speak your meal"}
                  style={{ top: 10, right: 10, width: 30, height: 30, borderRadius: "50%", background: listening ? C.pink : C.orangeTint }}>
                  <Mic size={14} color={listening ? "#fff" : C.orange} className={listening ? "animate-pulse" : ""} />
                </button>
              )}
              {listening && <div className="ft-body mt-1.5" style={{ fontSize: 11, color: C.pink }}>Listening… speak naturally, e.g. "2 rotis, one bowl dal, and 100 grams paneer"</div>}
            </div>
          )}
          {error && (<div className="flex items-start gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.pinkTint }}><AlertCircle size={15} color={C.pink} style={{ flexShrink: 0, marginTop: 1 }} /><span className="ft-body" style={{ fontSize: 12, color: C.pink }}>{error}</span></div>)}
          <button onClick={() => analyze()} disabled={analyzing || compressing} className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full ft-body" style={{ background: C.ink, color: C.onInk, fontSize: 14, fontWeight: 600, opacity: analyzing ? 0.7 : 1 }}>
            {analyzing ? <Loader2 size={16} className="animate-spin" /> : <Utensils size={16} />}{analyzing ? "Analyzing meal…" : "Analyze meal"}
          </button>
          {analyzing && <NutritionSkeleton />}
          <button onClick={() => setPending({ ...EMPTY_MEAL })}
            className="w-full flex items-center justify-center py-2.5 mt-2 ft-body" style={{ color: C.inkSoft, fontSize: 12.5, fontWeight: 500 }}>Skip — enter nutrition manually</button>
        </>
      )}
      {pending && (
        <div>
          <div className="flex items-start justify-between gap-2 mb-1">
            <input value={pending.food_name} onChange={(e) => updateField("food_name", e.target.value)} placeholder="Meal name" className="flex-1 ft-display"
              style={{ fontSize: 18, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none", borderBottom: `1px solid ${C.line}`, paddingBottom: 4 }} />
            <button onClick={() => onToggleFavorite && onToggleFavorite(pending)} className="p-1.5" style={{ flexShrink: 0 }} title="Favorite this meal">
              <Star size={18} color={C.tan} fill={isFav(pending.food_name) ? C.tan : "none"} />
            </button>
          </div>
          <input value={pending.estimated_portion} onChange={(e) => updateField("estimated_portion", e.target.value)} placeholder="Portion (e.g. 1 cup, 200g)"
            className="w-full ft-body mb-2" style={{ fontSize: 12, color: C.inkSoft, background: "transparent", border: "none", outline: "none" }} />

          {portionIsStale && (
            <div className="flex items-center justify-between gap-2 p-2.5 mb-3 rounded-xl" style={{ background: C.orangeTint }}>
              <span className="ft-body" style={{ fontSize: 12, color: C.orangeDeep, lineHeight: 1.35 }}>Portion changed — nutrition below is for the old amount.</span>
              <button onClick={recalculateFromPortion} disabled={recalculating} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-full ft-body flex-shrink-0"
                style={{ background: C.ink, color: C.onInk, fontSize: 12, fontWeight: 600, opacity: recalculating ? 0.7 : 1 }}>
                {recalculating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}{recalculating ? "Recalculating…" : "Recalculate nutrition"}
              </button>
            </div>
          )}
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
            {!editingEntry && (
              <button onClick={() => setPending(null)} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.card, color: C.ink, fontSize: 14, fontWeight: 600 }}><X size={16} /> Back</button>
            )}
            <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> {editingEntry ? "Save changes" : "Save log"}</button>
          </div>
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
            <span className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft, fontWeight: 600 }}>{activeSplit.name}</span>
          </div>
          <div className="flex gap-1.5 mb-2" style={{ overflowX: "auto" }}>
            {activeSplit.days.map((d) => (
              <button key={d.id} onClick={() => setSplitDayId(d.id === splitDayId ? null : d.id)} className="flex-shrink-0 px-3 py-1.5 rounded-full ft-body"
                style={{ background: splitDayId === d.id ? C.blue : C.card, color: splitDayId === d.id ? "#fff" : C.ink, fontSize: 12, fontWeight: 600 }}>
                {d.label}
              </button>
            ))}
          </div>
          {splitDay && (
            splitDay.exercises.length === 0 ? (
              <div className="ft-body" style={{ fontSize: 11.5, color: C.inkSoft }}>No exercises added to this day yet — edit your split in Profile.</div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {splitDay.exercises.map((ex, i) => {
                  const doneToday = exerciseLogs.some((e) => e.date === todayStr() && e.name.trim().toLowerCase() === ex.trim().toLowerCase());
                  return (
                    <button key={i} onClick={() => setName(ex)} className="flex items-center gap-1 px-2.5 py-1.5 rounded-full ft-body"
                      style={{ background: name === ex ? C.ink : doneToday ? C.greenTint : C.card, color: name === ex ? C.onInk : doneToday ? C.green : C.ink, fontSize: 11.5, fontWeight: 500 }}>
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
            <span className="ft-body" style={{ fontSize: 11.5, fontWeight: 700, color: C.inkSoft, letterSpacing: 0.5, textTransform: "uppercase" }}>Sets</span>
            <span className="ft-mono" style={{ fontSize: 10.5, color: C.inkSoft }}>kg × reps</span>
          </div>
          <div className="flex flex-col gap-2">
            {sets.map((s, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5" style={{ background: C.card, borderRadius: 16 }}>
                <span className="ft-mono" style={{ fontSize: 11, color: C.inkSoft, width: 16 }}>{i + 1}</span>
                <input type="number" inputMode="decimal" value={s.weight} onChange={(e) => updateSet(i, "weight", e.target.value)} placeholder="Weight"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, color: C.ink, borderRadius: 10, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
                <span className="ft-body" style={{ color: C.inkSoft, fontSize: 12 }}>×</span>
                <input type="number" inputMode="numeric" value={s.reps} onChange={(e) => updateSet(i, "reps", e.target.value)} placeholder="Reps"
                  className="flex-1 ft-mono text-center" style={{ background: C.bgBottom, color: C.ink, borderRadius: 10, padding: "8px 6px", border: "none", outline: "none", fontSize: 13 }} />
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
        <button onClick={save} className="flex-1 flex items-center justify-center gap-2 py-3 rounded-full ft-body" style={{ background: C.blue, color: "#fff", fontSize: 14, fontWeight: 600 }}><Check size={16} /> {editingEntry ? "Save changes" : "Save workout"}</button>
      </div>
      {!ai && <div className="ft-body text-center mt-2" style={{ fontSize: 11.5, color: C.inkSoft }}>You can save without AI feedback too.</div>}
    </div>
  );
}


   
function ProfilePanel({ goals, onSaveGoals, weights, onAddWeight, onDeleteWeight, darkMode, setDarkMode, splits, onSaveSplits }) {
  const [local, setLocal] = useState(goals);
  const [saved, setSaved] = useState(false);
  const [weightInput, setWeightInput] = useState("");
  const [goalsEditing, setGoalsEditing] = useState(false);
  const [exerciseSettingsOpen, setExerciseSettingsOpen] = useState(false);
  useEffect(() => setLocal(goals), [goals]);

  function toggleGoalsEditing() {
    if (goalsEditing) setLocal(goals); // discard any unsaved edits on cancel
    setSaved(false);
    setGoalsEditing((o) => !o);
  }

  function field(key, label, unit) {
  return (
  
      <div className="mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <span className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{label}</span>
          <span className="ft-mono" style={{ fontSize: 11, color: C.inkSoft }}>{unit}</span>
        </div>
        <input type="number" value={local[key]} onChange={(e) => { setLocal((p) => ({ ...p, [key]: num(e.target.value) })); setSaved(false); }}
          className="w-full p-3 rounded-2xl ft-mono" style={{ border: "none", background: C.card, color: C.ink, fontSize: 16, outline: "none" }} />
      </div>
    );
  }

  return (
    <div>      
    <div
      className="flex items-center justify-between p-4 mb-4"
      style={{ background: C.card, borderRadius: 18 }}
    >
      <span
        className="ft-body"
        style={{ fontSize: 14, fontWeight: 600, color: C.ink }}
      >
        🌙 Dark Mode
      </span>

      <button
        onClick={() => setDarkMode(!darkMode)}
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

      <div className="p-4 mb-4" style={{ background: C.card, borderRadius: 18 }}>
        <div className="flex items-center justify-between mb-1">
          <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Daily goals</span>
          <button onClick={toggleGoalsEditing} className="flex items-center gap-1 ft-body" style={{ fontSize: 12, fontWeight: 600, color: goalsEditing ? C.inkSoft : C.orange }}>
            {goalsEditing ? "Cancel" : <><Pencil size={12} /> Edit goals</>}
          </button>
        </div>

        {!goalsEditing ? (
          <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
            {[
              { label: "Calories", value: `${goals.calories} kcal` },
              { label: "Protein", value: `${goals.protein}g` },
              { label: "Carbs", value: `${goals.carbs}g` },
              { label: "Fat", value: `${goals.fat}g` },
              { label: "Fiber", value: `${goals.fiber}g` },
              { label: "Water", value: `${goals.water}ml` },
              ...(goals.targetWeight > 0 ? [{ label: "Goal weight", value: `${goals.targetWeight}kg` }] : []),
            ].map((g) => (
              <div key={g.label}>
                <div className="ft-body" style={{ fontSize: 10.5, color: C.inkSoft }}>{g.label}</div>
                <div className="ft-mono" style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{g.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            {field("calories", "Calories", "kcal")}{field("protein", "Protein", "g")}{field("carbs", "Carbohydrates", "g")}{field("fat", "Fat", "g")}{field("fiber", "Fiber", "g")}{field("water", "Water", "ml")}
            {field("targetWeight", "Goal weight", "kg (0 = off)")}
            <button onClick={async () => { await onSaveGoals(local); haptic("success"); setSaved(true); setGoalsEditing(false); }} className="w-full flex items-center justify-center gap-2 py-3 rounded-full ft-body"
              style={{ background: C.orange, color: "#fff", fontSize: 14, fontWeight: 600 }}>Save goals</button>
          </div>
        )}
      </div>

      <div className="ft-body mb-3" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Weight</div>
      <div className="flex gap-2 mb-4">
        <input type="number" inputMode="decimal" value={weightInput} onChange={(e) => setWeightInput(e.target.value)} placeholder="Today's weight"
          className="flex-1 p-3 rounded-2xl ft-body" style={{ border: "none", background: C.card, color: C.ink, fontSize: 14, outline: "none" }} />
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

      <button onClick={() => setExerciseSettingsOpen((o) => !o)} className="w-full flex items-center justify-between p-4 mt-6" style={{ background: C.card, borderRadius: 18 }}>
        <span className="ft-body" style={{ fontSize: 13, fontWeight: 700, color: C.ink, letterSpacing: 0.5, textTransform: "uppercase" }}>Exercise settings</span>
        <ChevronDown size={16} color={C.inkSoft} style={{ transform: exerciseSettingsOpen ? "rotate(180deg)" : "none", transition: "transform .2s ease" }} />
      </button>
      {exerciseSettingsOpen && (
        <div className="mt-3">
          <div className="ft-body mb-2 px-1" style={{ fontSize: 12, color: C.inkSoft }}>Workout split</div>
          <WorkoutSplitEditor splits={splits} onSave={onSaveSplits} />
        </div>
      )}
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
    <div className="p-4 mb-6" style={{ background: C.card, borderRadius: 18 }}>
      <input value={split.name} onChange={(e) => updateSplit({ ...split, name: e.target.value })} placeholder="Split name"
        className="w-full ft-body mb-3" style={{ fontSize: 14, fontWeight: 700, color: C.ink, background: "transparent", border: "none", outline: "none" }} />
      <div className="flex flex-col gap-3">
        {split.days.map((day) => (
          <div key={day.id} className="p-3" style={{ background: C.bgBottom, borderRadius: 14 }}>
            <div className="flex items-center justify-between mb-2 gap-2">
              <input value={day.label} onChange={(e) => updateDay(day.id, { label: e.target.value })} placeholder="Day label"
                className="ft-body" style={{ fontSize: 13, fontWeight: 600, color: C.ink, background: "transparent", border: "none", outline: "none", flex: 1, minWidth: 0 }} />
              <button onClick={() => removeDay(day.id)} style={{ flexShrink: 0 }}><Trash2 size={14} color={C.pink} /></button>
            </div>
            {day.exercises.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {day.exercises.map((ex, i) => (
                  <div key={i} className="flex items-center gap-1 pl-2.5 pr-1.5 py-1.5 rounded-full" style={{ background: C.card }}>
                    <span className="ft-body" style={{ fontSize: 11.5, color: C.ink }}>{ex}</span>
                    <button onClick={() => removeExercise(day.id, i)} className="flex items-center justify-center" style={{ width: 16, height: 16 }}><X size={10} color={C.inkSoft} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1.5">
              <input value={newExerciseText[day.id] || ""} onChange={(e) => setNewExerciseText((p) => ({ ...p, [day.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") addExercise(day.id); }}
                placeholder="Add exercise" className="flex-1 ft-body" style={{ fontSize: 12, color: C.ink, background: C.card, border: "none", borderRadius: 10, padding: "7px 10px", outline: "none" }} />
              <button onClick={() => addExercise(day.id)} className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: 10, background: C.orangeTint, flexShrink: 0 }}><Plus size={14} color={C.orange} /></button>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addDay} className="flex items-center gap-1.5 mt-3 ft-body" style={{ color: C.blue, fontSize: 12.5, fontWeight: 600 }}><Plus size={14} /> Add day</button>
    </div>
  );
}
