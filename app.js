const STORAGE_KEY = "gym_tracker_v2";
const API_STATE_ENDPOINT = "/api/state";
const REMOTE_ROW_ID = "default";
const CATEGORY_CYCLE = ["upper", "upper", "upper", "lower", "arms", "shoulders"];

const MUSCLE_TARGET_SETS = {
  chest: 10,
  triceps: 10,
  back: 10,
  shoulders: 8,
  quads: 6,
  hamstrings: 6
};

const state = normalizeState(loadState());
const charts = {};
const supabaseConfig = window.SUPABASE_CONFIG || null;
const supabaseClient =
  window.supabase && supabaseConfig?.url && supabaseConfig?.anonKey
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;
const syncProvider = supabaseClient ? "supabase" : "api";
let remoteReady = false;
let pendingRemoteSave = false;
let remoteSaveTimer = null;
if (!state.weeklyPRs.length && state.prHistory.length) {
  recomputeWeeklyPRs();
  saveState();
}
applyTheme();
applyColorVariables();
setupNavigation();
initializeByPage();
hydrateFromDatabase();

function initializeByPage() {
  const page = document.body.dataset.page || "dashboard";
  if (page === "dashboard") {
    renderDashboard();
    renderSuggestions();
    return;
  }
  if (page === "workout") {
    attachWorkoutEvents();
    renderWorkoutPage();
    return;
  }
  if (page === "nutrition") {
    attachNutritionEvents();
    renderNutritionPage();
    return;
  }
  if (page === "progress") {
    attachProgressEvents();
    renderProgressPage();
    return;
  }
  if (page === "settings") {
    attachSettingsEvents();
    renderSettingsPage();
  }
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") || getDefaultState();
  } catch (error) {
    console.error("Invalid saved state", error);
    return getDefaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (remoteReady) {
    queueRemoteSave();
  } else {
    pendingRemoteSave = true;
  }
}

async function hydrateFromDatabase() {
  if (syncProvider === "supabase") {
    await hydrateFromSupabase();
    return;
  }
  await hydrateFromApi();
}

async function hydrateFromSupabase() {
  try {
    const { data, error } = await supabaseClient
      .from("app_state")
      .select("state, updated_at")
      .eq("id", REMOTE_ROW_ID)
      .maybeSingle();

    if (error) {
      remoteReady = true;
      return;
    }
    if (data?.state && typeof data.state === "object") {
      replaceState(normalizeState(data.state));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyTheme();
      applyColorVariables();
      rerenderCurrentPage();
    }
  } catch (_error) {
    // Keep local mode if remote is unavailable.
  } finally {
    remoteReady = true;
    if (pendingRemoteSave) {
      pendingRemoteSave = false;
      queueRemoteSave();
    }
  }
}

async function hydrateFromApi() {
  try {
    const response = await fetch(API_STATE_ENDPOINT, { method: "GET" });
    if (!response.ok) {
      remoteReady = true;
      return;
    }
    const payload = await response.json();
    if (payload?.state && typeof payload.state === "object") {
      replaceState(normalizeState(payload.state));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      applyTheme();
      applyColorVariables();
      rerenderCurrentPage();
    }
  } catch (_error) {
    // Keep local mode if API is unavailable.
  } finally {
    remoteReady = true;
    if (pendingRemoteSave) {
      pendingRemoteSave = false;
      queueRemoteSave();
    }
  }
}

function queueRemoteSave() {
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(async () => {
    try {
      await saveRemoteState();
    } catch (_error) {
      // Local state is still persisted.
    }
  }, 350);
}

async function saveRemoteState() {
  if (syncProvider === "supabase") {
    await saveStateToSupabase();
    return;
  }
  await saveStateToApi();
}

async function saveStateToSupabase() {
  const payload = { id: REMOTE_ROW_ID, state };
  await supabaseClient.from("app_state").upsert(payload, { onConflict: "id" });
}

async function saveStateToApi() {
  await fetch(API_STATE_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state })
  });
}

function replaceState(next) {
  Object.keys(state).forEach((key) => delete state[key]);
  Object.assign(state, next);
}

function rerenderCurrentPage() {
  const page = document.body.dataset.page || "dashboard";
  if (page === "dashboard") {
    renderDashboard();
    renderSuggestions();
    return;
  }
  if (page === "workout") {
    renderWorkoutPage();
    return;
  }
  if (page === "nutrition") {
    renderNutritionPage();
    return;
  }
  if (page === "progress") {
    renderProgressPage();
    return;
  }
  if (page === "settings") {
    renderSettingsPage();
  }
}

function normalizeState(raw) {
  const normalizedWorkoutDays = migrateWorkoutDays(raw.workoutDays || []);
  return {
    settings: {
      theme: raw.settings?.theme || "dark",
      muscleColors: {
        chest: raw.settings?.muscleColors?.chest || "#ef4444",
        back: raw.settings?.muscleColors?.back || "#3b82f6",
        legs: raw.settings?.muscleColors?.legs || "#22c55e",
        triceps: raw.settings?.muscleColors?.triceps || "#f97316",
        shoulders: raw.settings?.muscleColors?.shoulders || "#8b5cf6",
        calories: raw.settings?.muscleColors?.calories || "#a855f7"
      }
    },
    workoutDays: normalizedWorkoutDays,
    nutritionLogs: raw.nutritionLogs || [],
    bodyLogs: raw.bodyLogs || [],
    stepLogs: raw.stepLogs || [],
    prHistory: raw.prHistory || [],
    weeklyPRs: raw.weeklyPRs || []
  };
}

function migrateWorkoutDays(workoutDays) {
  const names = workoutDays.map((day) => String(day?.name || "").toLowerCase());
  const hasLegacySplit = names.some((name) =>
    name.includes("upper a") ||
    name.includes("upper b") ||
    name.includes("upper c") ||
    name.includes("lower (maintenance)")
  );
  const hasNewSplit = names.some((name) => name.includes("push") || name.includes("chest and back"));
  if (hasLegacySplit && !hasNewSplit) {
    return getDefaultState().workoutDays;
  }
  return workoutDays;
}

function getDefaultState() {
  return {
    settings: {
      theme: "dark",
      muscleColors: {
        chest: "#ef4444",
        back: "#3b82f6",
        legs: "#22c55e",
        triceps: "#f97316",
        shoulders: "#8b5cf6",
        calories: "#a855f7"
      }
    },
    workoutDays: [
      {
        id: uid(),
        name: "Push",
        category: "upper",
        completedDates: [],
        exercises: [
          makeExercise("Bench Press", ["chest"], 0, 10, 3, ""),
          makeExercise("Incline DB Press", ["chest"], 0, 10, 3, ""),
          makeExercise("Chest Flies", ["chest"], 0, 12, 3, ""),
          makeExercise("Single Arm Tricep Pushdown", ["triceps"], 0, 12, 3, ""),
          makeExercise("JM Press", ["triceps"], 0, 10, 3, ""),
          makeExercise("Lateral Raises", ["shoulders"], 0, 15, 3, "")
        ]
      },
      {
        id: uid(),
        name: "Pull",
        category: "upper",
        completedDates: [],
        exercises: [
          makeExercise("Lat Pulldown", ["back"], 0, 10, 3, ""),
          makeExercise("Seated Row", ["back"], 0, 10, 3, ""),
          makeExercise("Low Iso Row", ["back"], 0, 10, 3, ""),
          makeExercise("Preacher Curl", ["back"], 0, 12, 3, ""),
          makeExercise("Hammer Curls", ["back"], 0, 12, 3, ""),
          makeExercise("Rear Delt Fly", ["shoulders"], 0, 15, 3, "")
        ]
      },
      {
        id: uid(),
        name: "Legs",
        category: "lower",
        completedDates: [],
        exercises: [
          makeExercise("Leg Extension", ["legs"], 0, 12, 3, ""),
          makeExercise("Leg Curl", ["legs"], 0, 12, 3, ""),
          makeExercise("Squat", ["legs"], 0, 8, 3, ""),
          makeExercise("Calf Raise on Leg Press", ["legs"], 0, 15, 3, ""),
          makeExercise("Abductor Open Leg", ["legs"], 0, 15, 3, ""),
          makeExercise("Cardio", ["legs"], 10, 1, 1, "10 min after leg workout")
        ]
      },
      {
        id: uid(),
        name: "Chest and Back",
        category: "upper",
        completedDates: [],
        exercises: [
          makeExercise("Bench Press", ["chest"], 0, 10, 3, ""),
          makeExercise("Incline DB Press", ["chest"], 0, 10, 3, ""),
          makeExercise("Chest Flies", ["chest"], 0, 12, 3, ""),
          makeExercise("Lat Pulldown", ["back"], 0, 10, 3, ""),
          makeExercise("Seated Row", ["back"], 0, 10, 3, ""),
          makeExercise("Low Iso Row", ["back"], 0, 10, 3, "")
        ]
      },
      {
        id: uid(),
        name: "Arm Day",
        category: "arms",
        completedDates: [],
        exercises: [
          makeExercise("Preacher Curls", ["back"], 0, 12, 3, ""),
          makeExercise("Incline Curl", ["back"], 0, 12, 3, ""),
          makeExercise("Reverse Curl", ["back"], 0, 12, 3, ""),
          makeExercise("Rope Pushdown", ["triceps"], 0, 12, 3, ""),
          makeExercise("JM Press", ["triceps"], 0, 10, 3, ""),
          makeExercise("Shoulder Press", ["shoulders"], 0, 10, 3, "If time"),
          makeExercise("Single Arm Pushdown", ["triceps"], 0, 12, 3, "If time")
        ]
      }
    ],
    nutritionLogs: [],
    bodyLogs: [],
    stepLogs: [],
    prHistory: [],
    weeklyPRs: []
  };
}

function makeExercise(name, muscles, weight, reps, sets, notes) {
  return {
    id: uid(),
    name,
    muscles,
    weight,
    reps,
    sets,
    notes,
    completedDates: []
  };
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function toISODate(date) {
  const local = new Date(date);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function getWeekKey(dateValue) {
  const date = new Date(dateValue);
  const dayNum = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - dayNum);
  return toISODate(date);
}

function setupNavigation() {
  const toggle = document.getElementById("menuToggleBtn");
  const nav = document.getElementById("topNav");
  if (!toggle || !nav) {
    return;
  }
  toggle.addEventListener("click", () => {
    nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", nav.classList.contains("open") ? "true" : "false");
  });
  nav.querySelectorAll("a").forEach((a) => {
    if (a.href === window.location.href) {
      a.classList.add("active");
    }
    a.addEventListener("click", () => nav.classList.remove("open"));
  });
}

function applyTheme() {
  document.body.classList.toggle("light", state.settings.theme === "light");
}

function applyColorVariables() {
  const root = document.documentElement.style;
  root.setProperty("--chest", state.settings.muscleColors.chest);
  root.setProperty("--back", state.settings.muscleColors.back);
  root.setProperty("--legs", state.settings.muscleColors.legs);
  root.setProperty("--triceps", state.settings.muscleColors.triceps);
  root.setProperty("--shoulders", state.settings.muscleColors.shoulders);
  root.setProperty("--calories", state.settings.muscleColors.calories);
}

function renderDashboard() {
  const statsWrap = document.getElementById("dashboardStats");
  const insightsWrap = document.getElementById("dashboardInsights");
  if (!statsWrap || !insightsWrap) {
    return;
  }
  const d = computeDashboard();
  statsWrap.innerHTML = "";
  [
    ["Workouts This Week", d.workoutCount],
    ["Weekly PRs", d.prThisWeek],
    ["Avg Calories", d.avgCaloriesThisWeek],
    ["Avg Steps", d.avgStepsThisWeek],
    ["Weight Delta", `${d.weightDelta > 0 ? "+" : ""}${d.weightDelta} kg`]
  ].forEach(([label, value]) => {
    const el = document.createElement("div");
    el.className = "stat-box";
    el.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    statsWrap.appendChild(el);
  });
  insightsWrap.innerHTML = "";
  d.insights.forEach((text) => {
    const el = document.createElement("div");
    el.className = "tip";
    el.textContent = text;
    insightsWrap.appendChild(el);
  });
}

function computeDashboard() {
  const today = toISODate(new Date());
  const thisWeek = getWeekKey(today);
  const lastWeekDate = new Date(today);
  lastWeekDate.setDate(lastWeekDate.getDate() - 7);
  const lastWeek = getWeekKey(lastWeekDate);
  const workoutCount = state.workoutDays.filter((day) => day.completedDates.some((d) => getWeekKey(d) === thisWeek)).length;
  const prThisWeek = state.weeklyPRs.filter((pr) => getWeekKey(pr.date) === thisWeek).length;
  const prLastWeek = state.weeklyPRs.filter((pr) => getWeekKey(pr.date) === lastWeek).length;
  const avgCaloriesThisWeek = round(avg(state.nutritionLogs.filter((n) => getWeekKey(n.date) === thisWeek).map((n) => n.calories)), 0);
  const avgCaloriesLastWeek = round(avg(state.nutritionLogs.filter((n) => getWeekKey(n.date) === lastWeek).map((n) => n.calories)), 0);
  const avgStepsThisWeek = round(avg(state.stepLogs.filter((s) => getWeekKey(s.date) === thisWeek).map((s) => s.steps)), 0);
  const weightThis = state.bodyLogs.filter((w) => getWeekKey(w.date) === thisWeek).slice(-1)[0]?.weight;
  const weightLast = state.bodyLogs.filter((w) => getWeekKey(w.date) === lastWeek).slice(-1)[0]?.weight;
  const weightDelta = round((weightThis ?? 0) - (weightLast ?? 0), 2);
  return {
    workoutCount,
    prThisWeek,
    avgCaloriesThisWeek,
    avgStepsThisWeek,
    weightDelta,
    insights: [
      `PR change vs last week: ${prThisWeek - prLastWeek >= 0 ? "+" : ""}${prThisWeek - prLastWeek}`,
      `Calories this week vs last: ${avgCaloriesThisWeek - avgCaloriesLastWeek >= 0 ? "+" : ""}${avgCaloriesThisWeek - avgCaloriesLastWeek}`,
      weightDelta < 0 ? "Cutting trend detected. Keep strength stable." : "Weight stable/up. Monitor intake and training performance."
    ]
  };
}

function renderSuggestions() {
  const wrap = document.getElementById("aiSuggestions");
  if (!wrap) {
    return;
  }
  wrap.innerHTML = "";
  generateSuggestions().forEach((message) => {
    const el = document.createElement("div");
    el.className = "tip";
    el.textContent = message;
    wrap.appendChild(el);
  });
}

function generateSuggestions() {
  const week = getWeekKey(toISODate(new Date()));
  const setsByMuscle = {};
  state.workoutDays.forEach((day) => {
    day.exercises.forEach((exercise) => {
      const trainedThisWeek = (exercise.completedDates || []).some((d) => getWeekKey(d) === week);
      if (!trainedThisWeek) {
        return;
      }
      exercise.muscles.forEach((muscle) => {
        setsByMuscle[muscle] = (setsByMuscle[muscle] || 0) + Number(exercise.sets || 0);
      });
    });
  });
  const messages = [];
  Object.entries(MUSCLE_TARGET_SETS).forEach(([muscle, target]) => {
    const done = setsByMuscle[muscle] || 0;
    if (done < target) {
      messages.push(`${capitalize(muscle)} is undertrained (${done}/${target} sets). Add 2-3 sets next session.`);
    }
  });
  const grouped = {};
  state.weeklyPRs.forEach((pr) => {
    const key = pr.exerciseName.toLowerCase();
    grouped[key] = grouped[key] || [];
    grouped[key].push(pr);
  });
  Object.entries(grouped).forEach(([name, entries]) => {
    const sorted = entries.sort((a, b) => a.date.localeCompare(b.date));
    if (sorted.length < 3) {
      return;
    }
    const change = sorted[sorted.length - 1].est1RM - sorted[0].est1RM;
    if (change <= 0.5) {
      messages.push(`${capitalize(name)} plateau detected. Keep load and add +1 rep on first two sets.`);
    } else {
      messages.push(`${capitalize(name)} progressing. Increase load by 1-2 kg next week.`);
    }
  });
  messages.push("Recovery tip: 7-8h sleep and 5-8 min shoulder/chest mobility after upper days.");
  messages.push("Form tip: stop each compound set with clean reps and stable technique.");
  return messages.slice(0, 9);
}

function attachWorkoutEvents() {
  const addDayBtn = document.getElementById("addDayBtn");
  if (addDayBtn) {
    addDayBtn.addEventListener("click", () => {
      const category = CATEGORY_CYCLE[state.workoutDays.length % CATEGORY_CYCLE.length];
      state.workoutDays.push({
        id: uid(),
        name: `New ${capitalize(category)} Day`,
        category,
        isCollapsed: true,
        completedDates: [],
        exercises: [makeExercise("New Exercise", [category], 0, 10, 3, "")]
      });
      saveState();
      renderWorkoutPage();
    });
  }
}

function renderWorkoutPage() {
  const container = document.getElementById("workoutDaysContainer");
  const dayTpl = document.getElementById("dayTemplate");
  const exTpl = document.getElementById("exerciseTemplate");
  if (!container || !dayTpl || !exTpl) {
    return;
  }
  container.innerHTML = "";
  state.workoutDays.forEach((day, dayIndex) => {
    const dayNode = dayTpl.content.cloneNode(true);
    const dayCard = dayNode.querySelector(".day-card");
    const dayNameInput = dayNode.querySelector(".day-name-input");
    const dayMeta = dayNode.querySelector(".day-meta");
    const listWrap = dayNode.querySelector(".exercise-list-wrap");
    const list = dayNode.querySelector(".exercise-list");
    const collapseBtn = dayNode.querySelector(".day-toggle-btn");
    const saveDayBtn = dayNode.querySelector(".save-day-btn");
    const removeDayBtn = dayNode.querySelector(".remove-day-btn");
    const addExerciseBtn = dayNode.querySelector(".add-exercise-btn");
    dayCard.classList.add(day.category || "upper");
    const dayNumber = dayIndex + 1;
    dayNameInput.value = day.name || `Day ${dayNumber} - ${capitalize(day.category)}`;
    dayMeta.textContent = `Day ${dayNumber} - ${capitalize(day.category)} | ${day.exercises.length} exercises`;
    if (typeof day.isCollapsed !== "boolean") {
      day.isCollapsed = true;
    }
    setDayCollapsed(dayCard, listWrap, collapseBtn, day.isCollapsed);

    dayNameInput.addEventListener("change", (event) => {
      day.name = event.target.value.trim() || day.name;
      saveState();
    });
    collapseBtn.addEventListener("click", () => {
      day.isCollapsed = !day.isCollapsed;
      setDayCollapsed(dayCard, listWrap, collapseBtn, day.isCollapsed);
      saveState();
    });
    saveDayBtn.addEventListener("click", () => {
      saveState();
      saveDayBtn.textContent = "Saved";
      setTimeout(() => {
        saveDayBtn.textContent = "Save Day";
      }, 900);
    });
    removeDayBtn.addEventListener("click", () => {
      state.workoutDays.splice(dayIndex, 1);
      saveState();
      renderWorkoutPage();
    });
    addExerciseBtn.addEventListener("click", () => {
      day.exercises.push(makeExercise("New Exercise", ["chest"], 0, 10, 3, ""));
      saveState();
      renderWorkoutPage();
    });

    day.exercises.forEach((ex, exIndex) => {
      const exNode = exTpl.content.cloneNode(true);
      const row = exNode.querySelector(".exercise-row");
      const nameInput = exNode.querySelector(".exercise-name");
      const primaryMuscleInput = exNode.querySelector(".exercise-primary-muscle");
      const weightInput = exNode.querySelector(".exercise-weight");
      const repsInput = exNode.querySelector(".exercise-reps");
      const setsInput = exNode.querySelector(".exercise-sets");
      const notesInput = exNode.querySelector(".exercise-notes");
      const saveExBtn = exNode.querySelector(".save-ex-btn");
      const completeCheck = exNode.querySelector(".exercise-complete");
      const upBtn = exNode.querySelector(".up-btn");
      const downBtn = exNode.querySelector(".down-btn");
      const removeBtn = exNode.querySelector(".remove-ex-btn");

      nameInput.value = ex.name;
      const primaryMuscle = normalizePrimaryMuscle(ex.muscles?.[0] || day.category || "chest");
      primaryMuscleInput.value = primaryMuscle;
      row.classList.add(`is-${primaryMuscle}`);
      weightInput.value = ex.weight;
      repsInput.value = ex.reps;
      setsInput.value = ex.sets;
      notesInput.value = ex.notes || "";
      const today = toISODate(new Date());
      completeCheck.checked = (ex.completedDates || []).includes(today);
      if (completeCheck.checked) {
        row.classList.add("done");
      }

      const update = () => {
        ex.name = nameInput.value.trim() || "Exercise";
        ex.muscles = [normalizePrimaryMuscle(primaryMuscleInput.value)];
        ex.weight = Number(weightInput.value || 0);
        ex.reps = Number(repsInput.value || 0);
        ex.sets = Number(setsInput.value || 0);
        ex.notes = notesInput.value.trim();
        row.classList.remove("is-chest", "is-back", "is-legs", "is-triceps", "is-shoulders");
        row.classList.add(`is-${ex.muscles[0]}`);
        saveState();
      };
      [nameInput, primaryMuscleInput, weightInput, repsInput, setsInput, notesInput].forEach((input) => input.addEventListener("change", update));

      saveExBtn.addEventListener("click", () => {
        update();
        saveExBtn.textContent = "Saved";
        setTimeout(() => {
          saveExBtn.textContent = "Save";
        }, 900);
      });

      completeCheck.addEventListener("change", () => {
        ex.completedDates = ex.completedDates || [];
        if (completeCheck.checked && !ex.completedDates.includes(today)) {
          ex.completedDates.push(today);
          row.classList.add("done");
          logExercisePR(ex, today);
        }
        if (!completeCheck.checked) {
          ex.completedDates = ex.completedDates.filter((d) => d !== today);
          row.classList.remove("done");
        }
        if (completeCheck.checked && !day.completedDates.includes(today)) {
          day.completedDates.push(today);
        }
        if (!completeCheck.checked) {
          const anyDoneToday = day.exercises.some((item) => (item.completedDates || []).includes(today));
          if (!anyDoneToday) {
            day.completedDates = day.completedDates.filter((d) => d !== today);
          }
        }
        saveState();
      });
      upBtn.addEventListener("click", () => reorder(day.exercises, exIndex, exIndex - 1, renderWorkoutPage));
      downBtn.addEventListener("click", () => reorder(day.exercises, exIndex, exIndex + 1, renderWorkoutPage));
      removeBtn.addEventListener("click", () => {
        day.exercises.splice(exIndex, 1);
        saveState();
        renderWorkoutPage();
      });
      list.appendChild(exNode);
    });
    container.appendChild(dayNode);
  });
}

function logExercisePR(exercise, date) {
  if (!exercise.name || !exercise.weight || !exercise.reps) {
    return;
  }
  const est1RM = exercise.weight * (1 + exercise.reps / 30);
  const key = exercise.name.toLowerCase();
  state.prHistory = state.prHistory.filter((row) => !(row.exerciseName.toLowerCase() === key && row.date === date));
  state.prHistory.push({
    id: uid(),
    date,
    exerciseName: exercise.name,
    est1RM: round(est1RM, 2),
    volume: round(exercise.weight * exercise.reps * exercise.sets, 1),
    muscles: exercise.muscles
  });
  recomputeWeeklyPRs();
}

function recomputeWeeklyPRs() {
  const map = {};
  state.prHistory.forEach((entry) => {
    const key = `${getWeekKey(entry.date)}__${entry.exerciseName.toLowerCase()}`;
    if (!map[key] || map[key].est1RM < entry.est1RM) {
      map[key] = entry;
    }
  });
  state.weeklyPRs = Object.values(map);
}

function renderMuscleTags(container, muscles) {
  container.innerHTML = "";
  muscles.forEach((muscle) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = muscle;
    const color = getMuscleColor(muscle);
    tag.style.background = color;
    tag.style.borderColor = color;
    container.appendChild(tag);
  });
}

function getMuscleColor(muscle) {
  const m = muscle.toLowerCase();
  if (m.includes("chest") || m.includes("upper")) return state.settings.muscleColors.chest;
  if (m.includes("triceps")) return state.settings.muscleColors.triceps;
  if (m.includes("back") || m.includes("lat")) return state.settings.muscleColors.back;
  if (m.includes("quad") || m.includes("hamstring") || m.includes("leg") || m.includes("glute") || m.includes("calf")) return state.settings.muscleColors.legs;
  if (m.includes("shoulder") || m.includes("delt")) return state.settings.muscleColors.shoulders;
  return state.settings.muscleColors.calories;
}

function normalizePrimaryMuscle(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("back")) return "back";
  if (v.includes("leg") || v.includes("quad") || v.includes("hamstring") || v.includes("glute") || v.includes("calf")) return "legs";
  if (v.includes("tricep")) return "triceps";
  if (v.includes("shoulder") || v.includes("delt")) return "shoulders";
  return "chest";
}

function setDayCollapsed(dayCard, listWrap, btn, collapsed) {
  dayCard.classList.toggle("day-collapsed", collapsed);
  listWrap.classList.toggle("collapsed", collapsed);
  btn.textContent = collapsed ? "-" : "+";
}

function attachNutritionEvents() {
  const form = document.getElementById("nutritionForm");
  if (!form) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const item = {
      id: uid(),
      date: data.get("date"),
      calories: Number(data.get("calories") || 0),
      protein: Number(data.get("protein") || 0),
      carbs: Number(data.get("carbs") || 0),
      fats: Number(data.get("fats") || 0)
    };
    if (!item.date || item.calories <= 0) {
      return;
    }
    state.nutritionLogs = upsertByDate(state.nutritionLogs, item);
    saveState();
    form.reset();
    renderNutritionPage();
  });
}

function renderNutritionPage() {
  const summaryWrap = document.getElementById("nutritionSummary");
  const tableWrap = document.getElementById("nutritionTable");
  if (!summaryWrap || !tableWrap) {
    return;
  }
  const weekKey = getWeekKey(toISODate(new Date()));
  const weekLogs = state.nutritionLogs.filter((n) => getWeekKey(n.date) === weekKey);
  const avgCal = round(avg(weekLogs.map((n) => n.calories)), 0);
  const avgP = round(avg(weekLogs.map((n) => n.protein)), 0);
  const avgC = round(avg(weekLogs.map((n) => n.carbs)), 0);
  const avgF = round(avg(weekLogs.map((n) => n.fats)), 0);
  summaryWrap.innerHTML = "";
  [
    ["Weekly Avg Calories", avgCal],
    ["Avg Protein", `${avgP} g`],
    ["Avg Carbs", `${avgC} g`],
    ["Avg Fats", `${avgF} g`]
  ].forEach(([label, value]) => {
    const box = document.createElement("div");
    box.className = "summary-box";
    box.innerHTML = `<div class="label">${label}</div><div class="value">${value}</div>`;
    summaryWrap.appendChild(box);
  });
  tableWrap.innerHTML = "";
  [...state.nutritionLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).forEach((log) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${log.date}</span><span>${log.calories} kcal | P:${log.protein} C:${log.carbs} F:${log.fats}</span>`;
    tableWrap.appendChild(row);
  });
  drawCaloriesChart("caloriesChart");
}

function drawCaloriesChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) {
    return;
  }
  const byWeek = aggregateByWeek(state.nutritionLogs, (n) => n.calories);
  const labels = Object.keys(byWeek);
  const data = Object.values(byWeek).map((x) => round(x.avg, 0));
  charts[canvasId] = buildOrUpdateChart(charts[canvasId], canvasId, {
    type: "line",
    data: {
      labels,
      datasets: [{ label: "Avg Daily Calories", data, borderColor: state.settings.muscleColors.calories, tension: 0.3 }]
    }
  });
}

function attachProgressEvents() {
  const form = document.getElementById("weightForm");
  const stepsForm = document.getElementById("stepsForm");
  if (!form) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const row = {
      id: uid(),
      date: data.get("date"),
      weight: Number(data.get("weight") || 0),
      bodyFat: data.get("bodyFat") ? Number(data.get("bodyFat")) : null
    };
    if (!row.date || row.weight <= 0) {
      return;
    }
    state.bodyLogs = upsertByDate(state.bodyLogs, row);
    saveState();
    form.reset();
    renderProgressPage();
  });
  if (stepsForm) {
    stepsForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(stepsForm);
      const row = {
        id: uid(),
        date: data.get("date"),
        steps: Number(data.get("steps") || 0)
      };
      if (!row.date || row.steps <= 0) {
        return;
      }
      state.stepLogs = upsertByDate(state.stepLogs, row);
      saveState();
      stepsForm.reset();
      renderProgressPage();
    });
  }
}

function renderProgressPage() {
  const tableWrap = document.getElementById("progressTable");
  const prWrap = document.getElementById("prList");
  const stepsWrap = document.getElementById("stepsTable");
  if (!tableWrap || !prWrap || !stepsWrap) {
    return;
  }
  tableWrap.innerHTML = "";
  [...state.bodyLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).forEach((entry, i, list) => {
    const prev = list[i + 1];
    const delta = prev ? round(entry.weight - prev.weight, 2) : 0;
    const cls = prev ? (delta <= 0 ? "improve" : "regress") : "";
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${entry.date}</span><span class="${cls}">${entry.weight} kg${prev ? ` | Delta ${delta > 0 ? "+" : ""}${delta}` : ""}</span>`;
    tableWrap.appendChild(row);
  });

  prWrap.innerHTML = "";
  [...state.weeklyPRs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).forEach((pr) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${pr.date} - ${pr.exerciseName}</span><span>${pr.est1RM} kg est1RM</span>`;
    prWrap.appendChild(row);
  });
  stepsWrap.innerHTML = "";
  [...state.stepLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${entry.date}</span><span>${entry.steps} steps</span>`;
    stepsWrap.appendChild(row);
  });

  drawWeightChart("weightChart");
  drawPRChart("prChart");
  drawCaloriesChart("caloriesTrendChart");
  drawStepsChart("stepsChart");
}

function drawStepsChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) {
    return;
  }
  const byWeek = aggregateByWeek(state.stepLogs, (x) => x.steps);
  charts[canvasId] = buildOrUpdateChart(charts[canvasId], canvasId, {
    type: "line",
    data: {
      labels: Object.keys(byWeek),
      datasets: [{ label: "Avg Daily Steps", data: Object.values(byWeek).map((x) => round(x.avg, 0)), borderColor: "#14b8a6", tension: 0.3 }]
    }
  });
}

function drawWeightChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) {
    return;
  }
  charts[canvasId] = buildOrUpdateChart(charts[canvasId], canvasId, {
    type: "line",
    data: {
      labels: state.bodyLogs.map((x) => x.date),
      datasets: [{ label: "Body Weight (kg)", data: state.bodyLogs.map((x) => x.weight), borderColor: "#f59e0b", tension: 0.3 }]
    }
  });
}

function drawPRChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) {
    return;
  }
  const byWeek = aggregateByWeek(state.weeklyPRs, (x) => x.est1RM);
  charts[canvasId] = buildOrUpdateChart(charts[canvasId], canvasId, {
    type: "bar",
    data: {
      labels: Object.keys(byWeek),
      datasets: [{ label: "Weekly Best PR", data: Object.values(byWeek).map((x) => round(x.max, 1)), backgroundColor: "#22c55e" }]
    }
  });
}

function attachSettingsEvents() {
  const toggleThemeBtn = document.getElementById("toggleThemeBtn");
  const colorForm = document.getElementById("colorForm");
  const resetDataBtn = document.getElementById("resetDataBtn");
  if (toggleThemeBtn) {
    toggleThemeBtn.addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      applyTheme();
      saveState();
    });
  }
  if (colorForm) {
    colorForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(colorForm);
      Object.keys(state.settings.muscleColors).forEach((key) => {
        state.settings.muscleColors[key] = data.get(key) || state.settings.muscleColors[key];
      });
      applyColorVariables();
      saveState();
      alert("Colors updated.");
    });
  }
  if (resetDataBtn) {
    resetDataBtn.addEventListener("click", () => {
      if (!window.confirm("Reset all data?")) return;
      const fresh = getDefaultState();
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, fresh);
      saveState();
      applyTheme();
      applyColorVariables();
      renderSettingsPage();
    });
  }
}

function renderSettingsPage() {
  const form = document.getElementById("colorForm");
  if (!form) {
    return;
  }
  Object.entries(state.settings.muscleColors).forEach(([key, value]) => {
    if (form.elements[key]) {
      form.elements[key].value = value;
    }
  });
}

function buildOrUpdateChart(instance, canvasId, config) {
  if (instance) {
    instance.destroy();
  }
  const gridColor = state.settings.theme === "dark" ? "#333333" : "#e2e8f0";
  const tickColor = state.settings.theme === "dark" ? "#cbd5e1" : "#475569";
  return new Chart(document.getElementById(canvasId), {
    ...config,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tickColor } } },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor } },
        y: { grid: { color: gridColor }, ticks: { color: tickColor } }
      }
    }
  });
}

function aggregateByWeek(list, getValue) {
  const map = {};
  list.forEach((item) => {
    const week = getWeekKey(item.date);
    map[week] = map[week] || { sum: 0, count: 0, max: -Infinity, avg: 0 };
    const value = Number(getValue(item) || 0);
    map[week].sum += value;
    map[week].count += 1;
    map[week].max = Math.max(map[week].max, value);
    map[week].avg = map[week].sum / map[week].count;
  });
  return map;
}

function upsertByDate(list, row) {
  const next = list.filter((x) => x.date !== row.date);
  next.push(row);
  return next.sort((a, b) => a.date.localeCompare(b.date));
}

function parseMuscles(text) {
  return text.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
}

function reorder(list, from, to, rerender) {
  if (to < 0 || to >= list.length) {
    return;
  }
  const moved = list.splice(from, 1)[0];
  list.splice(to, 0, moved);
  saveState();
  rerender();
}

function avg(values) {
  if (!values.length) return 0;
  return values.reduce((sum, n) => sum + n, 0) / values.length;
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "";
}
