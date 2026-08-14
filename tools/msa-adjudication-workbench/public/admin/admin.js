const loginPanel = document.querySelector("#admin-login");
const dashboard = document.querySelector("#admin-dashboard");
const loginStatus = document.querySelector("#login-status");
const dashboardStatus = document.querySelector("#dashboard-status");
const participantsBody = document.querySelector("#participants-body");
const emptyParticipants = document.querySelector("#empty-participants");
const searchInput = document.querySelector("#participant-search");
const statusSelect = document.querySelector("#participant-status");
const refreshButton = document.querySelector("#refresh-dashboard");
const logoutButton = document.querySelector("#admin-logout");

const state = {
  participants: []
};

refreshButton.addEventListener("click", loadProgress);
logoutButton.addEventListener("click", logout);
searchInput.addEventListener("input", renderParticipants);
statusSelect.addEventListener("change", renderParticipants);

initialize();

async function initialize() {
  const error = new URL(location.href).searchParams.get("error");
  if (error) {
    loginStatus.textContent = error === "forbidden"
      ? "الحساب صحيح، لكن صلاحية Global Administrator لم تثبت."
      : "تعذر إكمال دخول Microsoft Entra. تحقق من عنوان إعادة التوجيه.";
    loginStatus.className = "status error";
    history.replaceState({}, "", "/admin/");
  }

  try {
    const identity = await api("/api/admin/auth/me");
    if (!identity.authenticated || !identity.administrator) {
      showLogin();
      return;
    }
    showDashboard(identity);
    await loadProgress();
  } catch (requestError) {
    showLogin();
    loginStatus.textContent = requestError.message;
    loginStatus.className = "status error";
  }
}

function showLogin() {
  loginPanel.hidden = false;
  dashboard.hidden = true;
}

function showDashboard(identity) {
  loginPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelector("#admin-name").textContent =
    identity.displayName || "المسؤول";
  document.querySelector("#admin-source").textContent =
    authorityLabel(identity.authoritySource);
}

async function loadProgress() {
  setBusy(true);
  setDashboardStatus("جارٍ تحديث السجلات…", false);
  try {
    const result = await api("/api/admin/progress");
    state.participants = result.participants || [];
    renderSummary(result.summary);
    renderParticipants();
    document.querySelector("#generated-at").textContent =
      `آخر تحديث: ${formatDate(result.generatedAtUtc)}`;
    setDashboardStatus("", false);
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      showLogin();
      loginStatus.textContent =
        "انتهت الجلسة أو لم تعد صلاحية المسؤول متاحة.";
      loginStatus.className = "status error";
      return;
    }
    setDashboardStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

function renderSummary(summary = {}) {
  document.querySelector("#summary-total").textContent =
    summary.total ?? 0;
  document.querySelector("#summary-active").textContent =
    summary.active ?? 0;
  document.querySelector("#summary-completed").textContent =
    summary.completed ?? 0;
  document.querySelector("#summary-not-started").textContent =
    summary.notStarted ?? 0;
  document.querySelector("#summary-average").textContent =
    `${summary.averageProgress ?? 0}%`;
}

function renderParticipants() {
  participantsBody.replaceChildren();
  const query = searchInput.value.trim().toLocaleLowerCase("ar");
  const status = statusSelect.value;
  const visible = state.participants.filter(participant => {
    const matchesStatus = status === "all"
      || participant.status === status;
    const haystack = [
      participant.fullName,
      participant.email,
      participant.affiliation,
      ...Object.values(participant.socialAccounts || {})
    ].filter(Boolean).join(" ").toLocaleLowerCase("ar");
    return matchesStatus && (!query || haystack.includes(query));
  });

  visible.forEach(participant => {
    const row = document.createElement("tr");
    row.append(
      participantCell(participant),
      experienceCell(participant),
      assignmentCell(participant),
      progressCell(participant),
      textCell(
        participant.lastActivityUtc
          ? formatDate(participant.lastActivityUtc)
          : "لا يوجد نشاط",
        "muted"
      ),
      statusCell(participant.status)
    );
    participantsBody.append(row);
  });
  emptyParticipants.hidden = visible.length !== 0;
}

function participantCell(participant) {
  const cell = document.createElement("td");
  const wrapper = document.createElement("div");
  wrapper.className = "participant-name";
  const name = document.createElement("strong");
  name.textContent = participant.fullName;
  const email = document.createElement("a");
  email.href = `mailto:${participant.email}`;
  email.textContent = participant.email;
  const affiliation = document.createElement("span");
  affiliation.textContent = participant.affiliation || "بلا جهة مسجلة";
  wrapper.append(name, email, affiliation);
  const social = socialAccountsElement(participant.socialAccounts);
  if (social) wrapper.append(social);
  cell.append(wrapper);
  return cell;
}

function socialAccountsElement(accounts = {}) {
  const labels = {
    whatsapp: "واتساب",
    x: "X",
    tiktok: "TikTok",
    instagram: "Instagram",
    threads: "Threads",
    telegram: "Telegram",
    snapchat: "Snapchat",
    facebook: "Facebook",
    linkedin: "LinkedIn",
    youtube: "YouTube",
    bluesky: "Bluesky"
  };
  const links = {
    x: handle => `https://x.com/${encodeURIComponent(handle)}`,
    tiktok: handle =>
      `https://www.tiktok.com/@${encodeURIComponent(handle)}`,
    instagram: handle =>
      `https://www.instagram.com/${encodeURIComponent(handle)}`,
    threads: handle =>
      `https://www.threads.net/@${encodeURIComponent(handle)}`,
    telegram: handle => `https://t.me/${encodeURIComponent(handle)}`,
    snapchat: handle =>
      `https://www.snapchat.com/add/${encodeURIComponent(handle)}`,
    facebook: handle =>
      `https://www.facebook.com/${encodeURIComponent(handle)}`,
    linkedin: handle =>
      `https://www.linkedin.com/in/${encodeURIComponent(handle)}`,
    youtube: handle =>
      `https://www.youtube.com/@${encodeURIComponent(handle)}`,
    bluesky: handle =>
      `https://bsky.app/profile/${encodeURIComponent(handle)}`
  };
  const container = document.createElement("div");
  container.className = "social-handles";
  for (const [key, label] of Object.entries(labels)) {
    const handle = accounts[key];
    if (!handle) continue;
    const element = links[key]
      ? document.createElement("a")
      : document.createElement("span");
    if (links[key]) {
      element.href = links[key](handle);
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    }
    element.textContent = `${label}: @${handle}`;
    container.append(element);
  }
  if (accounts.otherPlatform && accounts.otherUsername) {
    const other = document.createElement("span");
    other.textContent =
      `${accounts.otherPlatform}: @${accounts.otherUsername}`;
    container.append(other);
  }
  return container.childElementCount === 0 ? null : container;
}

function experienceCell(participant) {
  const label = specializationLabel(participant.specialization);
  return textCell(`${label} · ${participant.experienceYears} سنة`);
}

function assignmentCell(participant) {
  const cell = document.createElement("td");
  if (participant.assignments.length === 0) {
    cell.textContent = "لم يختر مهمة بعد";
    cell.className = "muted";
    return cell;
  }
  participant.assignments.forEach(item => {
    const wrapper = document.createElement("div");
    wrapper.className = "assignment";
    const role = document.createElement("span");
    role.textContent = `${roleLabel(item.role)} · ${item.packetId}`;
    const detail = document.createElement("small");
    detail.textContent = item.status === "submitted"
      ? `تم الإرسال ${formatDate(item.submittedAtUtc)}`
      : `${item.completedFields}/${item.totalFields} حقلاً`;
    wrapper.append(role, detail);
    cell.append(wrapper);
  });
  return cell;
}

function progressCell(participant) {
  const cell = document.createElement("td");
  const track = document.createElement("progress");
  track.className = "progress-track";
  track.max = 100;
  track.value = participant.progressPercent;
  const label = document.createElement("strong");
  label.textContent = `${participant.progressPercent}%`;
  cell.append(track, label);
  return cell;
}

function statusCell(status) {
  const cell = document.createElement("td");
  const pill = document.createElement("span");
  pill.className = `status-pill ${status}`;
  pill.textContent = statusLabel(status);
  cell.append(pill);
  return cell;
}

function textCell(text, className = "") {
  const cell = document.createElement("td");
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

async function logout() {
  setBusy(true);
  try {
    await api("/api/admin/auth/logout", {
      method: "POST",
      body: {}
    });
    state.participants = [];
    showLogin();
    loginStatus.textContent = "تم تسجيل الخروج من اللوحة.";
    loginStatus.className = "status success";
  } catch (error) {
    setDashboardStatus(error.message, true);
  } finally {
    setBusy(false);
  }
}

async function api(path, options = {}) {
  const init = {
    method: options.method || "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" }
  };
  if (Object.hasOwn(options, "body")) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.message || "تعذر تحميل لوحة المتابعة."
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

function setBusy(busy) {
  refreshButton.disabled = busy;
  logoutButton.disabled = busy;
}

function setDashboardStatus(message, error) {
  dashboardStatus.textContent = message;
  dashboardStatus.className = `status${message
    ? error ? " error" : " success"
    : ""}`;
}

function statusLabel(status) {
  if (status === "submitted") return "تم الإرسال";
  if (status === "in-progress") return "قيد العمل";
  return "لم يبدأ";
}

function roleLabel(role) {
  if (role === "A") return "المعلّق A";
  if (role === "B") return "المعلّق B";
  return "المحكّم الثالث";
}

function specializationLabel(value) {
  return {
    grammar: "النحو",
    morphology: "الصرف",
    "arabic-education": "تعليم العربية",
    "quranic-arabic": "العربية القرآنية",
    linguistics: "اللسانيات",
    other: "تخصص عربي آخر"
  }[value] || value;
}

function authorityLabel(source) {
  return source === "signed-wids-claim"
    ? "الصلاحية مثبتة من توقيع Entra"
    : "الصلاحية مثبتة من Microsoft Graph";
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
