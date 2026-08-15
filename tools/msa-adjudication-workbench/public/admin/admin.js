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
const governanceTasksBody =
  document.querySelector("#governance-tasks-body");
const governanceAppealsBody =
  document.querySelector("#governance-appeals-body");
const governanceCommentsBody =
  document.querySelector("#governance-comments-body");

const state = {
  participants: [],
  governance: {
    tasks: [],
    appeals: [],
    comments: []
  }
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
    state.governance = result.governance || {
      tasks: [],
      appeals: [],
      comments: []
    };
    renderSummary(result.summary);
    renderParticipants();
    renderGovernance();
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
  const affiliation = document.createElement("span");
  affiliation.textContent = participant.affiliation || "بلا جهة مسجلة";
  wrapper.append(name);
  if (participant.email) {
    const email = document.createElement("a");
    email.href = `mailto:${participant.email}`;
    email.textContent = participant.email;
    wrapper.append(email);
  }
  wrapper.append(affiliation);
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
  if (participant.experienceYears === null) {
    return textCell("ممحوة وفق سياسة الاحتفاظ", "muted");
  }
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

function renderGovernance() {
  governanceTasksBody.replaceChildren();
  governanceAppealsBody.replaceChildren();
  governanceCommentsBody.replaceChildren();

  for (const task of state.governance.tasks || []) {
    const row = document.createElement("tr");
    row.append(
      textCell(
        task.repositoryTask
          ? `${task.repositoryTask.title} · ${task.packetId}`
          : `${task.packetId} · v${task.taskVersion}`
      ),
      textCell(task.state),
      textCell(String(task.round)),
      textCell(
        task.repositoryTask
          ? `${task.repositoryTask.repository}@`
            + task.repositoryTask.commitSha.slice(0, 8)
          : task.githubIssueNumber
            ? `${task.repositoryStatus} · #${task.githubIssueNumber}`
            : task.repositoryStatus
      ),
      taskAssignmentCell(task),
      taskReissueCell(task)
    );
    governanceTasksBody.append(row);
  }

  for (const appeal of state.governance.appeals || []) {
    const row = document.createElement("tr");
    const evidence = document.createElement("td");
    const title = document.createElement("strong");
    title.textContent = appeal.packetId;
    const text = document.createElement("p");
    text.textContent = appeal.evidence;
    evidence.append(title, text);
    row.append(
      evidence,
      textCell(appeal.status),
      appealReviewCell(appeal)
    );
    governanceAppealsBody.append(row);
  }

  for (const comment of state.governance.comments || []) {
    const row = document.createElement("tr");
    const detail = document.createElement("td");
    const title = document.createElement("strong");
    title.textContent =
      `${comment.participantPseudonym} · ${comment.packetId}`;
    const text = document.createElement("p");
    text.textContent = comment.body;
    detail.append(title, text);
    row.append(
      detail,
      textCell(comment.moderationState),
      commentModerationCell(comment)
    );
    governanceCommentsBody.append(row);
  }
}

function taskAssignmentCell(task) {
  const cell = document.createElement("td");
  if (!task.repositoryTask) {
    cell.textContent = "غير مسجلة من دليل مهام المستودع";
    cell.className = "muted";
    return cell;
  }
  if (task.repositoryTask.lane === "operational-test") {
    cell.textContent =
      "اختبار تشغيلي معزول؛ يظهر فقط عبر ?mode=operational-test "
      + "ولا يحجز أدوار الإجماع.";
    cell.className = "muted";
    return cell;
  }
  const assignments = document.createElement("div");
  assignments.className = "task-assignment-list";
  for (const assignment of task.assignments || []) {
    const item = document.createElement("span");
    item.textContent =
      `${assignment.role} · ${assignment.email} · `
      + assignmentStatusLabel(assignment.status);
    assignments.append(item);
  }
  if (!task.assignments?.length) {
    const empty = document.createElement("span");
    empty.className = "muted";
    empty.textContent = task.repositoryTask.assignmentMode === "open"
      ? "المهمة مفتوحة للاستلام."
      : "لا يوجد إسناد بعد.";
    assignments.append(empty);
  }

  const role = document.createElement("select");
  for (const value of ["A", "B", "J1", "J2"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    role.append(option);
  }
  const email = document.createElement("input");
  email.type = "email";
  email.autocomplete = "off";
  email.placeholder = "reviewer@example.com";
  email.maxLength = 254;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button primary compact";
  button.textContent = "إسناد وإرسال الدعوة";
  button.addEventListener("click", () => {
    void runGovernanceAction(button, async () => {
      if (!email.validity.valid || !email.value.trim()) {
        throw new Error("أدخل بريدًا إلكترونيًا صالحًا.");
      }
      await api("/api/admin/tasks/assign", {
        method: "POST",
        body: {
          taskVersionId: task.taskVersionId,
          role: role.value,
          email: email.value.trim()
        }
      });
    });
  });
  const form = document.createElement("div");
  form.className = "task-assignment-form";
  form.append(role, email, button);
  cell.append(assignments, form);
  return cell;
}

function assignmentStatusLabel(status) {
  return {
    invited: "دعوة جديدة",
    claimed: "استلم المهمة",
    submitted: "أرسل النتيجة",
    cancelled: "ملغى"
  }[status] || status;
}

function taskReissueCell(task) {
  const cell = document.createElement("td");
  if (!["escalated", "revoked"].includes(task.state)) {
    cell.textContent = "لا إجراء يدوي مطلوب";
    cell.className = "muted";
    return cell;
  }
  const select = document.createElement("select");
  for (const reason of [
    "missing-quorum-deadline",
    "accepted-recusal",
    "j2-disagreement",
    "accepted-appeal",
    "material-evidence-defect",
    "low-independent-agreement",
    "novel-primary-decision"
  ]) {
    const option = document.createElement("option");
    option.value = reason;
    option.textContent = reason;
    select.append(option);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "button secondary compact";
  button.textContent = "إعادة الطرح";
  button.addEventListener("click", async () => {
    await runGovernanceAction(button, async () => {
      await api("/api/admin/tasks/reissue", {
        method: "POST",
        body: {
          taskVersionId: task.taskVersionId,
          reason: select.value
        }
      });
    });
  });
  cell.append(select, button);
  return cell;
}

function appealReviewCell(appeal) {
  const cell = document.createElement("td");
  if (appeal.status !== "pending") {
    cell.textContent = "تم البت";
    cell.className = "muted";
    return cell;
  }
  const reason = document.createElement("textarea");
  reason.rows = 3;
  reason.maxLength = 4000;
  reason.placeholder = "تعليل مستقل من 20 حرفًا على الأقل";
  const accept = governanceButton("قبول", "primary", async () => {
    await reviewAppeal(appeal.id, "accepted", reason.value);
  });
  const reject = governanceButton("رفض", "secondary", async () => {
    await reviewAppeal(appeal.id, "rejected", reason.value);
  });
  cell.append(reason, accept, reject);
  return cell;
}

async function reviewAppeal(appealId, decision, reason) {
  if (reason.trim().length < 20) {
    throw new Error("اكتب تعليلًا من 20 حرفًا على الأقل.");
  }
  await api("/api/admin/appeals/review", {
    method: "POST",
    body: { appealId, decision, reason: reason.trim() }
  });
}

function commentModerationCell(comment) {
  const cell = document.createElement("td");
  const select = document.createElement("select");
  for (const value of ["hidden", "redacted", "blocked"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
  const reason = document.createElement("input");
  reason.maxLength = 1000;
  reason.placeholder = "سبب الإشراف";
  const button = governanceButton("تطبيق", "secondary", async () => {
    if (reason.value.trim().length < 10) {
      throw new Error("اكتب سببًا من 10 أحرف على الأقل.");
    }
    await api("/api/admin/discussion/moderate", {
      method: "POST",
      body: {
        commentId: comment.commentId,
        state: select.value,
        reason: reason.value.trim()
      }
    });
  });
  cell.append(select, reason, button);
  return cell;
}

function governanceButton(label, style, action) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${style} compact`;
  button.textContent = label;
  button.addEventListener("click", () => {
    void runGovernanceAction(button, action);
  });
  return button;
}

async function runGovernanceAction(button, action) {
  button.disabled = true;
  setDashboardStatus("", false);
  try {
    await action();
    await loadProgress();
  } catch (error) {
    setDashboardStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function logout() {
  setBusy(true);
  try {
    await api("/api/admin/auth/logout", {
      method: "POST",
      body: {}
    });
    state.participants = [];
    state.governance = { tasks: [], appeals: [], comments: [] };
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
  if (role === "adjudication" || role === "J1") return "المحكّم J1";
  if (role === "ratification" || role === "J2") return "المراجع J2";
  return role;
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
