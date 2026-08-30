import {
  ADJUDICATION_SCHEMA,
  ANNOTATION_SCHEMA,
  RATIFICATION_SCHEMA,
  computeAdjudicationMerkleRoot,
  computeAnnotationMerkleRoot,
  computePacketMerkleRoot,
  computeRatificationMerkleRoot,
  decisionNeedsResolution,
  inferLoadedPacketLane,
  sha256Json,
  tokenDecisionKey,
  unpackPortalFile,
  validatePacket,
  validateRatificationBinding,
  validateSubmissionBinding
} from "./protocol.js";

const UPOS = [
  ["ADJ", "صفة"],
  ["ADP", "حرف جر"],
  ["ADV", "ظرف"],
  ["AUX", "فعل مساعد"],
  ["CCONJ", "حرف عطف"],
  ["DET", "أداة تعريف"],
  ["INTJ", "اسم فعل أو صوت"],
  ["NOUN", "اسم"],
  ["NUM", "عدد"],
  ["PART", "أداة"],
  ["PRON", "ضمير"],
  ["PROPN", "اسم علم"],
  ["PUNCT", "علامة ترقيم"],
  ["SCONJ", "أداة ربط"],
  ["SYM", "رمز"],
  ["VERB", "فعل"],
  ["X", "غير مصنف"]
];

const RELATIONS = [
  ["acl", "صلة وصفية"],
  ["advcl", "جملة حالية أو ظرفية"],
  ["advmod", "متعلق ظرفي"],
  ["amod", "نعت"],
  ["appos", "بدل أو عطف بيان"],
  ["aux", "فعل مساعد"],
  ["case", "حرف جر"],
  ["cc", "حرف عطف"],
  ["ccomp", "مقول أو جملة متممة"],
  ["compound", "تركيب مركب"],
  ["conj", "معطوف"],
  ["cop", "رابط إسنادي"],
  ["dep", "علاقة عامة"],
  ["det", "تعريف"],
  ["discourse", "أداة خطاب"],
  ["fixed", "تركيب ثابت"],
  ["flat", "تركيب اسمي"],
  ["iobj", "مفعول غير مباشر"],
  ["mark", "أداة ربط"],
  ["nmod", "مضاف إليه أو متعلق اسمي"],
  ["nsubj", "فاعل أو مسند إليه"],
  ["nsubj:pass", "نائب فاعل"],
  ["obj", "مفعول به"],
  ["obl", "متعلق مجرور أو منصوب"],
  ["parataxis", "جملة مستقلة مرتبطة"],
  ["punct", "ترقيم"],
  ["root", "جذر الجملة"],
  ["xcomp", "متمم إسنادي"]
];

const IRAB = [
  ["_", "غير منطبق"],
  ["faail", "فاعل"],
  ["naaib-faail", "نائب فاعل"],
  ["mafool-bih", "مفعول به"],
  ["nat", "نعت"],
  ["mudaf-ilayh", "مضاف إليه"],
  ["khabar", "خبر"],
  ["hal", "حال"],
  ["mafool-mutlaq", "مفعول مطلق"],
  ["mafool-li-ajlih", "مفعول لأجله"],
  ["mafool-maah", "مفعول معه"]
];

const PUBLIC_PORTAL_URL = "https://adg.sbay.sa/";
const PORTAL_VERSION = "15.3.5";
const BASELINE_PILOT_PACKET_ID = "msa-adjudication-pilot-v1";
const OPERATIONAL_TEST_REQUESTED =
  new URL(location.href).searchParams.get("mode") === "operational-test";
const INVITATION_TEXT =
  "دعوة موجَّهة إلى معلّمي اللغة العربية وخبرائها للمشاركة في التحكيم "
  + "اللغوي المستقل لمحلّل ADG-Lang. لا يُشترط أي إلمام تقني، ويمكن حفظ "
  + "العمل والعودة إليه لاحقًا.";
const SOCIAL_FIELDS = [
  ["whatsapp", "social-whatsapp"],
  ["x", "social-x"],
  ["tiktok", "social-tiktok"],
  ["instagram", "social-instagram"],
  ["threads", "social-threads"],
  ["telegram", "social-telegram"],
  ["snapchat", "social-snapchat"],
  ["facebook", "social-facebook"],
  ["linkedin", "social-linkedin"],
  ["youtube", "social-youtube"],
  ["bluesky", "social-bluesky"]
];

const FIELD_HELP = {
  upos: "الصنف العام للكلمة، مثل اسم أو فعل أو ضمير.",
  head: "رقم الكلمة التي تتعلق بها؛ استخدم 0 لجذر الجملة.",
  relation: "اسم الصلة النحوية بين الكلمة ورأسها.",
  irabCategory: "الموقع الإعرابي ضمن الفئات المتاحة في هذه الجولة.",
  irabHead:
    "اختر الكلمة التي يرتبط بها هذا الدور. هذا ليس «العامل» "
    + "بمعناه النحوي النظري الكامل."
};

const state = {
  step: 1,
  participantId: crypto.randomUUID(),
  packet: null,
  annotationA: null,
  annotationB: null,
  primaryArtifact: null,
  currentTaskVersionId: null,
  currentTaskLane: null,
  issueReportId: crypto.randomUUID(),
  config: {
    submissionEnabled: false,
    maxSubmissionBytes: 900000,
    turnstileSiteKey: null,
    repository: "sbay-dev/ADG-Lang",
    accountEnabled: false,
    emailVerificationEnabled: false
  },
  account: {
    authenticated: false,
    userId: null,
    email: null,
    emailVerified: false,
    passkeyCount: 0,
    erasureRequested: false
  },
  emailVerification: {
    email: null,
    verificationId: null,
    token: null,
    verified: false,
    busy: false,
    cooldownUntil: 0,
    timer: null
  },
  discussion: {
    sourceReceiptId: null,
    data: null,
    replyTo: null,
    taskStatus: null
  },
  autosaveTimer: null,
  draftSavePromise: null,
  workspaceRevision: 0,
  serverDraftRevision: -1,
  draftSaving: false,
  turnstileWidgetId: null
};

const form = document.querySelector("#portal-form");
const nextButton = document.querySelector("#next-step");
const previousButton = document.querySelector("#previous-step");
const loadPilotButton = document.querySelector("#load-pilot");
const packetFile = document.querySelector("#packet-file");
const annotationAFile = document.querySelector("#annotation-a-file");
const annotationBFile = document.querySelector("#annotation-b-file");
const adjudicationFiles = document.querySelector("#adjudication-files");
const ratificationFiles = document.querySelector("#ratification-files");
const primaryAdjudicationFile =
  document.querySelector("#primary-adjudication-file");
const packetSummary = document.querySelector("#packet-summary");
const workspace = document.querySelector("#workspace");
const completionValue = document.querySelector("#completion-value");
const reviewSummary = document.querySelector("#review-summary");
const submitButton = document.querySelector("#submit");
const downloadButton = document.querySelector("#download");
const submissionStatus = document.querySelector("#submission-status");
const wizardStatus = document.querySelector("#wizard-status");
const quickLoginButton = document.querySelector("#quick-login");
const registerPasskeyButton = document.querySelector("#register-passkey");
const loginPasskeyButton = document.querySelector("#login-passkey");
const addPasskeyButton = document.querySelector("#add-passkey");
const logoutAccountButton = document.querySelector("#logout-account");
const requestErasureButton = document.querySelector("#request-erasure");
const accountTitle = document.querySelector("#account-title");
const accountDescription = document.querySelector("#account-description");
const accountStatus = document.querySelector("#account-status");
const emailInput = document.querySelector("#email");
const sendEmailCodeButton = document.querySelector("#send-email-code");
const emailCodeRow = document.querySelector("#email-code-row");
const emailCodeInput = document.querySelector("#email-code");
const verifyEmailCodeButton = document.querySelector("#verify-email-code");
const emailVerificationStatus =
  document.querySelector("#email-verification-status");
const saveDraftButton = document.querySelector("#save-draft");
const draftStatus = document.querySelector("#draft-status");
const savedDrafts = document.querySelector("#saved-drafts");
const draftList = document.querySelector("#draft-list");
const taskList = document.querySelector("#task-list");
const taskInboxStatus = document.querySelector("#task-inbox-status");
const refreshTasksButton = document.querySelector("#refresh-tasks");
const recoveryFile = document.querySelector("#recovery-file");
const recoveryStatus = document.querySelector("#recovery-status");
const manualTaskTools = document.querySelector("#manual-task-tools");
const shareWhatsapp = document.querySelector("#share-whatsapp");
const shareX = document.querySelector("#share-x");
const copyInvitationButton = document.querySelector("#copy-invitation");
const shareStatus = document.querySelector("#share-status");
const discussionPanel = document.querySelector("#discussion");
const discussionComposer = document.querySelector("#discussion-composer");
const previousResults = document.querySelector("#previous-results");
const discussionThread = document.querySelector("#discussion-thread");
const discussionTarget = document.querySelector("#discussion-target");
const discussionCategory = document.querySelector("#discussion-category");
const discussionSentence = document.querySelector("#discussion-sentence");
const discussionToken = document.querySelector("#discussion-token");
const discussionMentions = document.querySelector("#discussion-mentions");
const discussionReferences =
  document.querySelector("#discussion-references");
const discussionBody = document.querySelector("#discussion-body");
const submitDiscussionButton =
  document.querySelector("#submit-discussion");
const discussionStatus = document.querySelector("#discussion-status");
const replyContext = document.querySelector("#reply-context");
const replyContextText = document.querySelector("#reply-context-text");
const cancelReplyButton = document.querySelector("#cancel-reply");
const taskConsensusStatus =
  document.querySelector("#task-consensus-status");
const appealPanel = document.querySelector("#appeal-panel");
const appealEvidence = document.querySelector("#appeal-evidence");
const submitAppealButton = document.querySelector("#submit-appeal");
const attestIndependentLabel =
  document.querySelector("#attest-independent-label");
const attestBlindLabel =
  document.querySelector("#attest-blind-label");
const attestAuthenticLabel =
  document.querySelector("#attest-authentic-label");
const appealStatus = document.querySelector("#appeal-status");
const openIssueReportButton =
  document.querySelector("#open-issue-report");
const issueReportDialog =
  document.querySelector("#issue-report-dialog");
const issueReportForm =
  document.querySelector("#issue-report-form");
const closeIssueReportButton =
  document.querySelector("#close-issue-report");
const issueReportCategory =
  document.querySelector("#issue-report-category");
const issueReportSummary =
  document.querySelector("#issue-report-summary");
const issueReportDetails =
  document.querySelector("#issue-report-details");
const issueReportSteps =
  document.querySelector("#issue-report-steps");
const issueReportPrivacy =
  document.querySelector("#issue-report-privacy");
const submitIssueReportButton =
  document.querySelector("#submit-issue-report");
const issueReportStatus =
  document.querySelector("#issue-report-status");
const recentIssueReports =
  document.querySelector("#recent-issue-reports");

document.querySelectorAll('input[name="role"]').forEach(control => {
  control.addEventListener("change", syncRoleControls);
});
nextButton.addEventListener("click", goNext);
previousButton.addEventListener("click", goPrevious);
loadPilotButton.addEventListener("click", loadPilot);
packetFile.addEventListener("change", loadPacketFile);
submitButton.addEventListener("click", submitEvaluation);
downloadButton.addEventListener("click", downloadEvaluation);
quickLoginButton.addEventListener("click", loginWithPasskey);
registerPasskeyButton.addEventListener("click", registerPasskey);
loginPasskeyButton.addEventListener("click", loginWithPasskey);
addPasskeyButton.addEventListener("click", addPasskey);
logoutAccountButton.addEventListener("click", logoutAccount);
requestErasureButton.addEventListener("click", requestIdentityErasure);
sendEmailCodeButton.addEventListener("click", sendEmailVerificationCode);
verifyEmailCodeButton.addEventListener("click", verifyEmailVerificationCode);
emailInput.addEventListener("input", handleEmailInput);
emailCodeInput.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    void verifyEmailVerificationCode();
  }
});
emailCodeInput.addEventListener("input", renderEmailVerificationState);
saveDraftButton.addEventListener("click", saveDraft);
refreshTasksButton.addEventListener("click", refreshTaskInbox);
recoveryFile.addEventListener("change", restoreRecoveryFile);
copyInvitationButton.addEventListener("click", copyInvitation);
submitDiscussionButton.addEventListener("click", submitDiscussionComment);
cancelReplyButton.addEventListener("click", clearDiscussionReply);
submitAppealButton.addEventListener("click", submitConsensusAppeal);
openIssueReportButton.addEventListener("click", openIssueReport);
closeIssueReportButton.addEventListener("click", () => {
  issueReportDialog.close();
});
issueReportForm.addEventListener("submit", submitIssueReport);
workspace.addEventListener("input", () => {
  state.workspaceRevision += 1;
  updateCompletion();
  persistCurrentDraftLocally();
  scheduleAutosave();
});
workspace.addEventListener("change", event => {
  if (event.target.matches(".irab-category")) {
    syncIrabHead(event.target);
  }
  state.workspaceRevision += 1;
  updateCompletion();
  persistCurrentDraftLocally();
  scheduleAutosave();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden"
      && [4, 5].includes(state.step)
      && state.packet) {
    persistCurrentDraftLocally();
    void saveDraft({ silent: true });
  }
});
window.addEventListener("pagehide", flushDraftOnPageHide);

configureSharing();
initialize();

function configureSharing() {
  const message = `${INVITATION_TEXT}\n\n${PUBLIC_PORTAL_URL}`;
  shareWhatsapp.href =
    `https://wa.me/?text=${encodeURIComponent(message)}`;
  shareX.href =
    "https://twitter.com/intent/tweet?text="
    + encodeURIComponent(INVITATION_TEXT)
    + `&url=${encodeURIComponent(PUBLIC_PORTAL_URL)}`;
}

async function copyInvitation() {
  const message = `${INVITATION_TEXT}\n\n${PUBLIC_PORTAL_URL}`;
  try {
    await navigator.clipboard.writeText(message);
    shareStatus.textContent = "نُسخت الدعوة.";
  } catch {
    shareStatus.textContent =
      "تعذر النسخ الآلي؛ استخدم خيار واتساب أو X.";
  }
}

function openIssueReport() {
  issueReportStatus.textContent = "";
  issueReportStatus.className = "status";
  submitIssueReportButton.disabled = !state.account.authenticated;
  if (!state.account.authenticated) {
    issueReportStatus.textContent =
      "يتطلب الإرسال الآلي تسجيل الدخول. إذا كان الخلل يمنع الدخول، "
      + "فاستخدم نموذج GitHub الاحتياطي.";
    issueReportStatus.className = "status error";
    recentIssueReports.replaceChildren();
  } else {
    void refreshIssueReports();
  }
  if (!issueReportDialog.open) issueReportDialog.showModal();
}

async function submitIssueReport(event) {
  event.preventDefault();
  issueReportStatus.textContent = "";
  issueReportStatus.className = "status";
  submitIssueReportButton.disabled = true;
  try {
    if (!state.account.authenticated) {
      throw new Error(
        "سجّل الدخول لإرسال البلاغ آليًا، أو استخدم نموذج GitHub الاحتياطي."
      );
    }
    const result = await apiJson("/api/issue-reports", {
      method: "POST",
      body: {
        schema: "adg-portal-issue-report-v1",
        reportId: state.issueReportId,
        category: issueReportCategory.value,
        summary: issueReportSummary.value,
        details: issueReportDetails.value,
        reproductionSteps: issueReportSteps.value || null,
        privacyConfirmed: issueReportPrivacy.checked,
        context: {
          portalVersion: PORTAL_VERSION,
          step: state.step,
          taskVersionId: state.currentTaskVersionId,
          taskLane: state.currentTaskLane,
          operationalMode: OPERATIONAL_TEST_REQUESTED
            || state.currentTaskLane === "operational-test"
        }
      }
    });
    issueReportStatus.textContent = result.duplicate
      ? "سبق استلام هذا البلاغ، وحالته محفوظة دون إنشاء نسخة مكررة."
      : "استُلم البلاغ. ستنشئه قناة المستودع كمسألة عامة دون بيانات هويتك.";
    issueReportStatus.className = "status success";
    state.issueReportId = crypto.randomUUID();
    issueReportForm.reset();
    await refreshIssueReports();
  } catch (error) {
    issueReportStatus.textContent = error.message;
    issueReportStatus.className = "status error";
  } finally {
    submitIssueReportButton.disabled = !state.account.authenticated;
  }
}

async function refreshIssueReports() {
  recentIssueReports.replaceChildren();
  if (!state.account.authenticated) return;
  try {
    const result = await apiJson("/api/issue-reports");
    const reports = result.reports || [];
    if (reports.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "لا توجد بلاغات سابقة لهذا الحساب.";
      recentIssueReports.append(empty);
      return;
    }
    reports.forEach(report => {
      const item = document.createElement("article");
      item.className = "recent-issue-report";
      const summary = document.createElement("strong");
      summary.textContent = report.summary;
      const status = document.createElement("small");
      status.textContent = report.status === "published"
        ? `نُشر في المستودع · ${formatDate(report.publishedAtUtc)}`
        : report.status === "claimed"
          ? "سحبته قناة المستودع ويجري نشره"
          : "بانتظار قناة المستودع";
      item.append(summary, status);
      if (report.status === "published" && report.issueUrl) {
        const link = document.createElement("a");
        link.href = report.issueUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = `Issue #${report.issueNumber}`;
        item.append(link);
      }
      recentIssueReports.append(item);
    });
  } catch (error) {
    const failure = document.createElement("p");
    failure.className = "status error";
    failure.textContent = error.message;
    recentIssueReports.append(failure);
  }
}

async function initialize() {
  applyRoleFromQuery();
  syncRoleControls();
  manualTaskTools.hidden =
    new URL(location.href).searchParams.get("legacy-files") !== "1";
  try {
    const response = await fetch("/api/config", {
      headers: { accept: "application/json" }
    });
    if (response.ok) {
      state.config = await response.json();
    }
  } catch {
    // Local-file use remains available without a backend.
  }
  await restoreAccount();
  if (state.account.authenticated) {
    await refreshTaskInbox();
  }
  await configureTurnstile();
  const discussionReceipt =
    new URL(location.href).searchParams.get("discussion");
  if (state.account.authenticated
      && /^[0-9a-f-]{36}$/i.test(discussionReceipt || "")) {
    showStep(5);
    await loadDiscussion(discussionReceipt);
  }
}

function applyRoleFromQuery() {
  const role = new URL(location.href).searchParams.get("role");
  const normalized = role?.toLowerCase();
  const value = normalized === "b"
    ? "B"
    : ["ratification", "j2"].includes(normalized)
      ? "ratification"
    : normalized === "adjudication"
      ? "adjudication"
      : "A";
  const control = document.querySelector(
    `input[name="role"][value="${value}"]`
  );
  if (control) control.checked = true;
}

async function goNext() {
  clearStatus();
  try {
    if (state.step === 1) {
      validateProfile();
      if (state.account.authenticated) {
        await updateAccountPreferences();
      }
    } else if (state.step === 2) {
      if (!state.account.authenticated) {
        throw new Error(
          "سجّل مفتاح المرور أو ادخل إلى حسابك قبل اختيار المهمة."
        );
      }
      await Promise.all([refreshDraftList(), refreshTaskInbox()]);
    } else if (state.step === 3) {
      await prepareCase();
    } else if (state.step === 4) {
      await flushDraftSave();
      await validateWorkspace();
      renderReview();
    } else {
      return;
    }
    showStep(state.step + 1);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function goPrevious() {
  clearStatus();
  if (state.step === 5 && state.packet) {
    await flushDraftSave();
  }
  if (state.step > 1) showStep(state.step - 1);
}

function showStep(step) {
  state.step = step;
  document.querySelectorAll(".step-panel").forEach(panel => {
    const active = Number(panel.dataset.step) === step;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  document.querySelectorAll("[data-step-indicator]").forEach(indicator => {
    const value = Number(indicator.dataset.stepIndicator);
    indicator.classList.toggle("active", value === step);
    indicator.classList.toggle("complete", value < step);
  });
  previousButton.hidden = step === 1;
  nextButton.hidden = step === 5;
  nextButton.textContent = step === 4 ? "مراجعة النتيجة" : "التالي";
  if (step === 5) {
    void ensureTurnstileWidget().catch(error => {
      showStatus(error.message, true);
    });
  }
  if (step === 3 && state.account.authenticated) {
    void refreshTaskInbox();
  }
  document.querySelector("#adjudication").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

function validateProfile() {
  const fullName = value("full-name");
  const email = normalizedCurrentEmail();
  const years = Number(value("experience-years"));
  requireText(fullName, "الاسم الكامل");
  requireText(email, "البريد الإلكتروني");
  requireText(value("specialization"), "مجال التخصص");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("أدخل بريدًا إلكترونيًا صالحًا.");
  }
  if (!Number.isInteger(years) || years < 0 || years > 80) {
    throw new Error("سنوات الخبرة يجب أن تكون بين صفر و80.");
  }
  validateSocialAccounts(socialAccounts());
  if (!checked("privacy-consent")) {
    throw new Error("الموافقة على حفظ بيانات التواصل مطلوبة للإرسال.");
  }
  if (!currentEmailIsVerified()) {
    throw new Error(
      "أرسل رمز التحقق إلى بريدك وأكّد الرمز قبل المتابعة."
    );
  }
}

function normalizedCurrentEmail() {
  return value("email").normalize("NFKC").trim().toLowerCase();
}

function currentEmailIsVerified() {
  const email = normalizedCurrentEmail();
  if (!email) return false;
  if (state.emailVerification.verified
      && state.emailVerification.email === email
      && state.emailVerification.token) {
    return true;
  }
  return state.account.authenticated
    && state.account.emailVerified
    && state.account.email === email;
}

function handleEmailInput() {
  const email = normalizedCurrentEmail();
  if (state.emailVerification.email
      && state.emailVerification.email !== email) {
    resetEmailVerification();
    setEmailVerificationStatus("", false);
  }
  if (!state.emailVerification.verificationId
      && state.account.authenticated) {
    const originalVerified = state.account.emailVerified
      && state.account.email === email;
    setEmailVerificationStatus(
      originalVerified
        ? "البريد موثّق لهذا الحساب."
        : "وثّق العنوان الجديد قبل حفظه.",
      !originalVerified
    );
  }
  renderEmailVerificationState();
}

function resetEmailVerification() {
  if (state.emailVerification.timer !== null) {
    clearInterval(state.emailVerification.timer);
  }
  state.emailVerification.email = null;
  state.emailVerification.verificationId = null;
  state.emailVerification.token = null;
  state.emailVerification.verified = false;
  state.emailVerification.busy = false;
  state.emailVerification.cooldownUntil = 0;
  state.emailVerification.timer = null;
  emailCodeInput.value = "";
}

function renderEmailVerificationState() {
  const email = normalizedCurrentEmail();
  const syntacticallyValid =
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && email.length <= 160;
  const verified = currentEmailIsVerified();
  const remaining = Math.max(
    0,
    Math.ceil((state.emailVerification.cooldownUntil - Date.now()) / 1000)
  );

  emailCodeRow.hidden = !state.emailVerification.verificationId || verified;
  sendEmailCodeButton.textContent = verified
    ? "البريد موثّق"
    : remaining > 0
      ? `إعادة الإرسال خلال ${remaining} ث`
      : "إرسال رمز";
  sendEmailCodeButton.disabled =
    verified
    || state.emailVerification.busy
    || remaining > 0
    || !syntacticallyValid
    || !state.config.emailVerificationEnabled;
  verifyEmailCodeButton.disabled =
    state.emailVerification.busy
    || !state.emailVerification.verificationId
    || !/^\d{6}$/.test(emailCodeInput.value.trim());
}

function startEmailCooldown(seconds) {
  state.emailVerification.cooldownUntil = Date.now() + seconds * 1000;
  if (state.emailVerification.timer !== null) {
    clearInterval(state.emailVerification.timer);
  }
  state.emailVerification.timer = setInterval(() => {
    renderEmailVerificationState();
    if (Date.now() >= state.emailVerification.cooldownUntil) {
      clearInterval(state.emailVerification.timer);
      state.emailVerification.timer = null;
    }
  }, 1000);
}

async function sendEmailVerificationCode() {
  const email = normalizedCurrentEmail();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setEmailVerificationStatus("أدخل بريدًا إلكترونيًا صالحًا أولًا.", true);
    return;
  }
  state.emailVerification.busy = true;
  setEmailVerificationStatus("جارٍ إرسال رمز التحقق الآمن...", false);
  renderEmailVerificationState();
  try {
    const result = await apiJson("/api/account/email/send-code", {
      method: "POST",
      body: { email }
    });
    resetEmailVerification();
    state.emailVerification.email = email;
    state.emailVerification.verificationId = result.verificationId;
    startEmailCooldown(Number(result.resendAfterSeconds || 60));
    setEmailVerificationStatus(result.message, false);
    emailCodeInput.focus();
  } catch (error) {
    state.emailVerification.busy = false;
    setEmailVerificationStatus(error.message, true);
  } finally {
    state.emailVerification.busy = false;
    renderEmailVerificationState();
  }
}

async function verifyEmailVerificationCode() {
  const code = emailCodeInput.value.trim();
  if (!state.emailVerification.verificationId
      || !/^\d{6}$/.test(code)) {
    setEmailVerificationStatus(
      "أدخل رمز التحقق المكون من ستة أرقام.",
      true
    );
    return;
  }
  state.emailVerification.busy = true;
  setEmailVerificationStatus("جارٍ تأكيد الرمز...", false);
  renderEmailVerificationState();
  try {
    const result = await apiJson("/api/account/email/verify-code", {
      method: "POST",
      body: {
        verificationId: state.emailVerification.verificationId,
        code
      }
    });
    state.emailVerification.email = normalizedCurrentEmail();
    state.emailVerification.token = result.verificationToken;
    state.emailVerification.verified = result.verified === true;
    setEmailVerificationStatus(result.message, false);
  } catch (error) {
    setEmailVerificationStatus(error.message, true);
  } finally {
    state.emailVerification.busy = false;
    renderEmailVerificationState();
  }
}

function setEmailVerificationStatus(message, error) {
  emailVerificationStatus.textContent = message || "";
  emailVerificationStatus.className = `inline-status${message
    ? error ? " error" : " success"
    : ""}`;
}

function accountProfile() {
  return {
    fullName: value("full-name"),
    email: normalizedCurrentEmail(),
    experienceYears: Number(value("experience-years")),
    specialization: value("specialization"),
    affiliation: nullable(value("affiliation")),
    socialAccounts: socialAccounts()
  };
}

function socialAccounts() {
  const accounts = {};
  for (const [key, id] of SOCIAL_FIELDS) {
    const handle = normalizeSocialHandle(value(id));
    if (handle) accounts[key] = handle;
  }
  const otherPlatform = value("social-other-platform");
  const otherUsername = normalizeSocialHandle(
    value("social-other-username")
  );
  if (otherPlatform) accounts.otherPlatform = otherPlatform;
  if (otherUsername) accounts.otherUsername = otherUsername;
  return accounts;
}

function normalizeSocialHandle(handle) {
  return handle.trim().replace(/^@+/, "");
}

function validateSocialAccounts(accounts) {
  if (accounts.whatsapp
      && !/^[a-z][a-z0-9._]{2,34}$/.test(accounts.whatsapp)) {
    throw new Error(
      "اسم مستخدم واتساب يجب أن يبدأ بحرف لاتيني صغير، وأن يتكون "
      + "من 3 إلى 35 حرفًا أو رقمًا أو نقطة أو شرطة سفلية."
    );
  }
  for (const [key, handle] of Object.entries(accounts)) {
    if (key === "otherPlatform") continue;
    if (!/^[^\s/@?#]{1,80}$/u.test(handle)) {
      throw new Error(
        "اكتب أسماء المستخدم من دون @ أو مسافات أو روابط كاملة."
      );
    }
  }
  const hasOtherPlatform = Boolean(accounts.otherPlatform);
  const hasOtherUsername = Boolean(accounts.otherUsername);
  if (hasOtherPlatform !== hasOtherUsername) {
    throw new Error(
      "أكمل اسم المنصة الأخرى واسم المستخدم فيها معًا."
    );
  }
  if (hasOtherPlatform
      && (accounts.otherPlatform.length < 2
        || accounts.otherPlatform.length > 40)) {
    throw new Error("اسم المنصة الأخرى غير صالح.");
  }
}

function accountConsent() {
  return {
    identityStorage: checked("privacy-consent"),
    futureContact: checked("contact-consent"),
    discussionNotifications: checked("discussion-consent")
  };
}

async function updateAccountPreferences() {
  const result = await apiJson("/api/account/preferences", {
    method: "PUT",
    body: {
      profile: accountProfile(),
      consent: accountConsent(),
      emailVerificationToken: state.emailVerification.token
    }
  });
  state.account.email = normalizedCurrentEmail();
  state.account.emailVerified = result.emailVerified === true;
  resetEmailVerification();
  setEmailVerificationStatus("البريد موثّق لهذا الحساب.", false);
  renderEmailVerificationState();
  setAccountStatus(result.message, false);
}

async function restoreAccount() {
  if (!state.config.accountEnabled) {
    renderAccountState();
    return;
  }
  try {
    const account = await apiJson("/api/account");
    state.account.authenticated = true;
    state.account.userId = account.userId;
    fillProfile(account.profile, account.consent);
    state.account.email = String(account.profile?.email || "")
      .normalize("NFKC")
      .trim()
      .toLowerCase();
    state.account.emailVerified = account.emailVerified === true;
    state.account.passkeyCount = Number(account.passkeyCount || 0);
    state.account.erasureRequested =
      account.identityErasure?.requested === true;
    resetEmailVerification();
    setEmailVerificationStatus(
      state.account.emailVerified
        ? "البريد موثّق لهذا الحساب."
        : "يلزم توثيق البريد مرة واحدة قبل متابعة التحكيم.",
      !state.account.emailVerified
    );
    renderEmailVerificationState();
    renderAccountState();
    await refreshDraftList();
  } catch (error) {
    if (error.status !== 401) {
      setAccountStatus(error.message, true);
    }
    state.account.authenticated = false;
    state.account.userId = null;
    state.account.email = null;
    state.account.emailVerified = false;
    state.account.passkeyCount = 0;
    state.account.erasureRequested = false;
    resetEmailVerification();
    setEmailVerificationStatus("", false);
    renderEmailVerificationState();
    renderAccountState();
  }
}

function fillProfile(profile, consent) {
  if (!profile) return;
  document.querySelector("#full-name").value = profile.fullName ?? "";
  document.querySelector("#email").value = profile.email ?? "";
  document.querySelector("#experience-years").value =
    profile.experienceYears ?? "";
  document.querySelector("#specialization").value =
    profile.specialization ?? "";
  document.querySelector("#affiliation").value =
    profile.affiliation ?? "";
  const social = profile.socialAccounts ?? {};
  for (const [key, id] of SOCIAL_FIELDS) {
    document.querySelector(`#${id}`).value = social[key] ?? "";
  }
  document.querySelector("#social-other-platform").value =
    social.otherPlatform ?? "";
  document.querySelector("#social-other-username").value =
    social.otherUsername ?? "";
  document.querySelector("#privacy-consent").checked =
    consent?.identityStorage === true;
  document.querySelector("#contact-consent").checked =
    consent?.futureContact === true;
  document.querySelector("#discussion-consent").checked =
    consent?.discussionNotifications === true;
}

function renderAccountState() {
  const supported = webAuthnSupported();
  const available = state.config.accountEnabled && supported;
  const authenticated = state.account.authenticated;

  registerPasskeyButton.hidden = authenticated;
  loginPasskeyButton.hidden = authenticated;
  addPasskeyButton.hidden = !authenticated;
  logoutAccountButton.hidden = !authenticated;
  requestErasureButton.hidden =
    !authenticated || state.account.erasureRequested;
  quickLoginButton.hidden = authenticated;
  registerPasskeyButton.disabled = !available;
  loginPasskeyButton.disabled = !available;
  addPasskeyButton.disabled = !available;
  quickLoginButton.disabled = !available;

  if (authenticated) {
    accountTitle.textContent = "حسابك متصل ومحمي";
    accountDescription.textContent =
      `البريد الموثّق هو مالك الحساب، ويرتبط به `
      + `${state.account.passkeyCount} من مفاتيح المرور. `
      + "يمكنك إضافة مفتاح لجهاز آخر الآن.";
    return;
  }
  accountTitle.textContent = "أنشئ حسابك الآمن";
  accountDescription.textContent = available
    ? "وثّق بريدك برمز قصير، ثم احفظ الدخول بمفتاح مرور بلا كلمة مرور."
    : "هذا المتصفح أو خدمة الحساب لا يدعم مفتاح المرور حاليًا.";
  renderEmailVerificationState();
}

async function registerPasskey() {
  clearStatus();
  setAccountStatus("", false);
  let verificationReserved = false;
  try {
    validateProfile();
    ensureWebAuthn();
    setAccountBusy(true);
    const start = await apiJson(
      "/api/account/register/options",
      {
        method: "POST",
        body: {
          profile: accountProfile(),
          consent: accountConsent(),
          emailVerificationToken: state.emailVerification.token
        }
      }
    );
    verificationReserved = true;
    const credential = await navigator.credentials.create({
      publicKey: registrationOptions(start.options)
    });
    if (!credential) {
      throw new Error("لم يُنشأ مفتاح المرور.");
    }
    const result = await apiJson(
      "/api/account/register/verify",
      {
        method: "POST",
        body: {
          challengeId: start.challengeId,
          response: registrationResponse(credential)
        }
      }
    );
    state.account.authenticated = true;
    state.account.userId = result.userId;
    state.account.email = normalizedCurrentEmail();
    state.account.emailVerified = true;
    state.account.passkeyCount = Number(result.passkeyCount || 1);
    state.account.erasureRequested = false;
    resetEmailVerification();
    setEmailVerificationStatus("البريد موثّق لهذا الحساب.", false);
    renderEmailVerificationState();
    renderAccountState();
    setAccountStatus(result.message, false);
    await refreshDraftList();
  } catch (error) {
    if (verificationReserved || error.status === 403 || error.status === 409) {
      resetEmailVerification();
      setEmailVerificationStatus(
        "أرسل رمزًا جديدًا قبل إعادة محاولة إنشاء مفتاح المرور.",
        true
      );
      renderEmailVerificationState();
    }
    setAccountStatus(passkeyErrorMessage(error), true);
  } finally {
    setAccountBusy(false);
  }
}

async function addPasskey() {
  clearStatus();
  setAccountStatus("", false);
  try {
    ensureWebAuthn();
    setAccountBusy(true);
    const start = await apiJson(
      "/api/account/passkeys/register/options",
      { method: "POST", body: {} }
    );
    const credential = await navigator.credentials.create({
      publicKey: registrationOptions(start.options)
    });
    if (!credential) {
      throw new Error("لم يُنشأ مفتاح المرور.");
    }
    const result = await apiJson(
      "/api/account/passkeys/register/verify",
      {
        method: "POST",
        body: {
          challengeId: start.challengeId,
          response: registrationResponse(credential)
        }
      }
    );
    state.account.passkeyCount = Number(
      result.passkeyCount || state.account.passkeyCount + 1
    );
    renderAccountState();
    setAccountStatus(result.message, false);
  } catch (error) {
    setAccountStatus(passkeyErrorMessage(error), true);
  } finally {
    setAccountBusy(false);
  }
}

async function loginWithPasskey(event) {
  clearStatus();
  setAccountStatus("", false);
  const quickLogin = event?.currentTarget === quickLoginButton;
  try {
    ensureWebAuthn();
    setAccountBusy(true);
    const start = await apiJson(
      "/api/account/login/options",
      { method: "POST", body: {} }
    );
    const credential = await navigator.credentials.get({
      publicKey: authenticationOptions(start.options)
    });
    if (!credential) {
      throw new Error("لم يُحدد مفتاح مرور.");
    }
    const result = await apiJson(
      "/api/account/login/verify",
      {
        method: "POST",
        body: {
          challengeId: start.challengeId,
          response: authenticationResponse(credential)
        }
      }
    );
    state.account.authenticated = true;
    state.account.userId = result.userId;
    await restoreAccount();
    setAccountStatus(result.message, false);
    if (quickLogin) showStep(3);
  } catch (error) {
    const message = passkeyErrorMessage(error);
    setAccountStatus(message, true);
    if (quickLogin) showStatus(message, true);
  } finally {
    setAccountBusy(false);
  }
}

async function requestIdentityErasure() {
  const confirmed = window.confirm(
    "سيُجدول محو بيانات التواصل ومفاتيح الدخول بعد إغلاق المهام "
    + "وانقضاء مدة الاحتفاظ، مع بقاء الأدلة العلمية مجهّلة. وفي نمط D1 "
    + "قد تبقى لقطات Time Travel القابلة للاسترجاع حتى انتهاء نافذة الخطة. "
    + "هل تتابع؟"
  );
  if (!confirmed) return;
  try {
    setAccountBusy(true);
    const result = await apiJson(
      "/api/account/privacy/erasure",
      {
        method: "POST",
        body: { confirm: true }
      }
    );
    setAccountStatus(
      `سُجل الطلب. يصبح مؤهلًا لحذف المخزن النشط في `
      + `${formatDate(result.eligibleAfterUtc)}.`
      + (result.providerBackupRetentionDays
        ? ` وقد تبقى لقطات D1 القابلة للاسترجاع حتى انقضاء `
          + `${result.providerBackupRetentionDays} يومًا من تاريخ التنفيذ.`
        : ""),
      false
    );
    state.account.erasureRequested = true;
    requestErasureButton.hidden = true;
  } catch (error) {
    setAccountStatus(error.message, true);
  } finally {
    setAccountBusy(false);
  }
}

async function logoutAccount() {
  try {
    setAccountBusy(true);
    await apiJson(
      "/api/account/logout",
      { method: "POST", body: {} }
    );
    state.account.authenticated = false;
    state.account.userId = null;
    state.account.email = null;
    state.account.emailVerified = false;
    state.account.passkeyCount = 0;
    state.account.erasureRequested = false;
    state.packet = null;
    state.annotationA = null;
    state.annotationB = null;
    state.primaryArtifact = null;
    workspace.replaceChildren();
    packetSummary.hidden = true;
    savedDrafts.hidden = true;
    form.reset();
    resetEmailVerification();
    setEmailVerificationStatus("", false);
    applyRoleFromQuery();
    syncRoleControls();
    renderEmailVerificationState();
    renderAccountState();
    showStep(1);
  } catch (error) {
    setAccountStatus(error.message, true);
  } finally {
    setAccountBusy(false);
  }
}

function setAccountBusy(busy) {
  registerPasskeyButton.disabled = busy;
  loginPasskeyButton.disabled = busy;
  addPasskeyButton.disabled = busy;
  quickLoginButton.disabled = busy;
  logoutAccountButton.disabled = busy;
  requestErasureButton.disabled = busy;
  if (busy) {
    sendEmailCodeButton.disabled = true;
    verifyEmailCodeButton.disabled = true;
  } else {
    renderAccountState();
    renderEmailVerificationState();
  }
}

function setAccountStatus(message, error) {
  accountStatus.textContent = message || "";
  accountStatus.className = `status${message
    ? error ? " error" : " success"
    : ""}`;
}

function webAuthnSupported() {
  return Boolean(
    window.PublicKeyCredential
    && navigator.credentials
    && navigator.credentials.create
    && navigator.credentials.get
  );
}

function ensureWebAuthn() {
  if (!state.config.accountEnabled) {
    throw new Error("خدمة الحساب غير مفعّلة حاليًا.");
  }
  if (!webAuthnSupported()) {
    throw new Error(
      "استخدم متصفحًا حديثًا يدعم مفاتيح المرور مثل Safari أو Chrome أو Edge."
    );
  }
}

function registrationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64UrlToBuffer(options.user.id)
    },
    excludeCredentials: (options.excludeCredentials || []).map(item => ({
      ...item,
      id: base64UrlToBuffer(item.id)
    }))
  };
}

function authenticationOptions(options) {
  return {
    ...options,
    challenge: base64UrlToBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map(item => ({
      ...item,
      id: base64UrlToBuffer(item.id)
    }))
  };
}

function registrationResponse(credential) {
  const response = credential.response;
  const publicKey = response.getPublicKey?.();
  const authenticatorData = response.getAuthenticatorData?.();
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment:
      credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      attestationObject: bufferToBase64Url(response.attestationObject),
      transports: response.getTransports?.() || [],
      publicKeyAlgorithm: response.getPublicKeyAlgorithm?.(),
      publicKey: publicKey ? bufferToBase64Url(publicKey) : undefined,
      authenticatorData: authenticatorData
        ? bufferToBase64Url(authenticatorData)
        : undefined
    }
  };
}

function authenticationResponse(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: bufferToBase64Url(credential.rawId),
    type: credential.type,
    authenticatorAttachment:
      credential.authenticatorAttachment ?? undefined,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      signature: bufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64Url(response.userHandle)
        : undefined
    }
  };
}

function base64UrlToBuffer(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized
    + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(
    binary,
    character => character.charCodeAt(0)
  ).buffer;
}

function bufferToBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function passkeyErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "أُلغي استخدام مفتاح المرور أو انتهت المهلة. أعد المحاولة.";
  }
  if (error?.name === "InvalidStateError") {
    return "مفتاح المرور هذا مسجل مسبقًا لهذا الموقع.";
  }
  return error?.message || "تعذر استخدام مفتاح المرور.";
}

async function apiJson(path, options = {}) {
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
      payload.message || "تعذر إكمال الطلب بأمان."
    );
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function refreshTaskInbox() {
  taskList.replaceChildren();
  taskInboxStatus.textContent = "";
  taskInboxStatus.className = "status";
  if (!state.account.authenticated) {
    taskInboxStatus.textContent =
      "سجّل الدخول لعرض المهام المفتوحة أو المسندة إلى بريدك.";
    return;
  }
  refreshTasksButton.disabled = true;
  try {
    const taskQuery = OPERATIONAL_TEST_REQUESTED
      ? "?mode=operational-test"
      : "";
    const result = await apiJson(`/api/tasks${taskQuery}`);
    const tasks = result.tasks || [];
    if (tasks.length === 0) {
      taskInboxStatus.textContent =
        "لا توجد مهمة جاهزة لهذا الحساب الآن. "
        + "ستظهر المهمة هنا عند نشرها أو إسنادها.";
      return;
    }
    tasks.forEach(task => taskList.append(repositoryTaskCard(task)));
  } catch (error) {
    taskInboxStatus.textContent = error.message;
    taskInboxStatus.className = "status error";
  } finally {
    refreshTasksButton.disabled = false;
  }
}

function repositoryTaskCard(task) {
  const card = document.createElement("article");
  card.className = "task-card";
  if (task.baseline || task.lane === "operational-test") {
    card.classList.add("baseline");
  }
  const main = document.createElement("div");
  main.className = "task-card-main";
  const heading = document.createElement("div");
  heading.className = "task-card-heading";
  const title = document.createElement("h5");
  title.textContent = task.title;
  heading.append(title);
  if (task.lane === "operational-test") {
    heading.append(taskBadge("العيّنة الأساسية", "complete"));
    heading.append(taskBadge("معزولة عن الإجماع", "waiting"));
  }
  if (task.new) heading.append(taskBadge("جديدة"));
  if (!task.ready && task.status !== "submitted") {
    heading.append(taskBadge("بانتظار المرحلة السابقة", "waiting"));
  }
  if (task.status === "submitted") {
    heading.append(taskBadge("مكتملة", "complete"));
  }
  const summary = document.createElement("p");
  summary.textContent = task.summary;
  const baselineNote = document.createElement("p");
  baselineNote.className = "task-card-baseline-note";
  baselineNote.textContent =
    "ابدأ بهذه العيّنة للتأكد من سلامة الحفظ والإرسال قبل المهام العلمية.";
  const meta = document.createElement("div");
  meta.className = "task-card-meta";
  const role = document.createElement("small");
  role.textContent = task.role
    ? `الدور: ${roleLabel(task.clientRole)}`
    : "الدور يثبت عند الاستلام";
  const packet = document.createElement("small");
  packet.textContent = `الحزمة: ${task.packetId}`;
  const source = document.createElement("small");
  source.textContent =
    `المصدر: ${task.source.repository}@${task.source.commitSha.slice(0, 8)}`;
  meta.append(role, packet, source);
  if (task.draft) {
    const draft = document.createElement("small");
    draft.textContent =
      `مسودة محفوظة: ${task.draft.progressPercent}% · `
      + formatDate(task.draft.updatedAtUtc);
    meta.append(draft);
  }
  main.append(heading, summary);
  if (task.lane === "operational-test") main.append(baselineNote);
  main.append(meta);

  const button = document.createElement("button");
  button.type = "button";
  button.className = "button primary compact";
  button.disabled = !task.ready || task.status === "submitted";
  button.textContent = task.status === "claimed"
    ? "متابعة المهمة"
    : task.status === "submitted"
      ? "أُنجزت"
      : task.ready
        ? "استلام وبدء"
        : "غير جاهزة";
  button.addEventListener("click", () => openRepositoryTask(task, button));
  card.append(main, button);
  return card;
}

function taskBadge(text, modifier = "") {
  const badge = document.createElement("span");
  badge.className = `task-badge${modifier ? ` ${modifier}` : ""}`;
  badge.textContent = text;
  return badge;
}

async function openRepositoryTask(task, button) {
  clearStatus();
  button.disabled = true;
  try {
    const mode = task.lane === "operational-test"
      ? { mode: "operational-test" }
      : {};
    const payload = task.status === "claimed"
      ? await apiJson(
        `/api/tasks/load?${new URLSearchParams({
          taskVersionId: task.taskVersionId,
          ...mode
        })}`
      )
      : await apiJson("/api/tasks/claim", {
        method: "POST",
        body: {
          taskVersionId: task.taskVersionId,
          ...mode
        }
      });
    await hydrateRepositoryTask(payload);
  } catch (error) {
    showStatus(error.message, true);
    button.disabled = false;
    await refreshTaskInbox();
  }
}

async function hydrateRepositoryTask(payload) {
  validatePacket(payload.packet);
  const roleControl = document.querySelector(
    `input[name="role"][value="${payload.clientRole}"]`
  );
  if (!roleControl) throw new Error("الدور المسند غير مدعوم في هذه الواجهة.");
  roleControl.checked = true;
  syncRoleControls();
  state.currentTaskVersionId = payload.taskVersionId;
  state.currentTaskLane = payload.lane;
  state.packet = payload.packet;
  state.annotationA = payload.annotationA ?? null;
  state.annotationB = payload.annotationB ?? null;
  state.primaryArtifact = payload.primaryArtifact ?? null;

  if (payload.clientRole === "adjudication") {
    await validateSubmissionBinding(state.packet, state.annotationA);
    await validateSubmissionBinding(state.packet, state.annotationB);
    renderAdjudication();
  } else if (payload.clientRole === "ratification") {
    if (!state.primaryArtifact
        || state.primaryArtifact.kind !== "adjudication-package") {
      throw new Error("مدخلات المراجعة النهائية غير مكتملة.");
    }
    await renderRatification();
  } else {
    renderAnnotation();
  }
  state.workspaceRevision = 0;
  state.serverDraftRevision = -1;
  await applyBestAvailableDraft(payload.packet, payload.clientRole);
  renderPacketSummary("مهمة موثقة من المستودع");
  updateCompletion();
  showStep(4);
}

async function applyBestAvailableDraft(packet, role) {
  let serverDraft = null;
  let serverUpdatedAt = 0;
  try {
    const query = new URLSearchParams({
      packetId: packet.packetId,
      role
    });
    const result = await apiJson(`/api/draft?${query}`);
    if (result.found
        && result.draft?.schema === "adg-msa-portal-draft-v1") {
      serverDraft = result.draft;
      serverUpdatedAt = Date.parse(result.updatedAtUtc) || 0;
    }
  } catch (error) {
    if (error.status !== 404) {
      setDraftStatus(
        "تعذر جلب نسخة الخادم؛ ستبقى نسخة الاسترداد على هذا الجهاز.",
        true
      );
    }
  }
  const local = readLocalDraft(packet.packetId, role);
  const localUpdatedAt = Date.parse(local?.savedAtUtc || "") || 0;
  const selected = localUpdatedAt > serverUpdatedAt ? local : serverDraft;
  if (!selected) return;
  applyWorkspace(selected.fields);
  state.participantId = selected.participantId || state.participantId;
  state.workspaceRevision += 1;
  if (selected === local) {
    setDraftStatus(
      `استُعيدت أحدث نسخة من هذا الجهاز (${formatDate(local.savedAtUtc)}).`,
      false
    );
  } else {
    setDraftStatus(
      `استُعيدت نسخة الخادم (${formatDate(serverUpdatedAt)}).`,
      false
    );
  }
}

async function restoreRecoveryFile() {
  recoveryStatus.textContent = "";
  recoveryStatus.className = "status";
  try {
    const loaded = await readJson(
      recoveryFile.files[0],
      "نسخة الاسترداد"
    );
    const unpacked = unpackPortalFile(loaded);
    if (unpacked.kind === "annotation-artifact") {
      validatePacket(unpacked.packet);
      await validateSubmissionBinding(
        unpacked.packet,
        unpacked.annotation
      );
      const roleControl = document.querySelector(
        `input[name="role"][value="${unpacked.role}"]`
      );
      if (!roleControl) throw new Error("دور نسخة الاسترداد غير مدعوم.");
      roleControl.checked = true;
      syncRoleControls();
      state.currentTaskVersionId = null;
      state.currentTaskLane = draftTaskLane({
        packet: unpacked.packet,
        role: unpacked.role
      });
      state.packet = unpacked.packet;
      state.annotationA = null;
      state.annotationB = null;
      state.primaryArtifact = null;
      renderAnnotation();
      applyWorkspace(annotationWorkspaceFields(unpacked.annotation));
      state.workspaceRevision += 1;
      renderPacketSummary("نسخة محلية مستردة");
      updateCompletion();
      showStep(4);
      await saveDraft({ silent: false });
      recoveryStatus.textContent =
        "استُعيدت جميع القرارات اللغوية وحُفظت كمسودة جديدة. "
        + "ستُنشأ التعهدات من جلستك الحالية عند الإرسال.";
      recoveryStatus.className = "status success";
      return;
    }
    if (unpacked.kind === "draft") {
      await restoreDraftObject(unpacked.draft, "نسخة استرداد محلية");
      await saveDraft({ silent: false });
      recoveryStatus.textContent =
        "استُعيدت المسودة وحُفظت من جديد على الحساب.";
      recoveryStatus.className = "status success";
      return;
    }
    if (unpacked.kind === "adjudication-artifact") {
      validatePacket(unpacked.packet);
      const roleControl = document.querySelector(
        'input[name="role"][value="ratification"]'
      );
      roleControl.checked = true;
      syncRoleControls();
      state.currentTaskVersionId = null;
      state.currentTaskLane = draftTaskLane({
        packet: unpacked.packet,
        role: "ratification"
      });
      state.packet = unpacked.packet;
      state.annotationA = null;
      state.annotationB = null;
      state.primaryArtifact = unpacked.artifact;
      await renderRatification();
      state.workspaceRevision += 1;
      renderPacketSummary("حزمة J1 مستردة");
      updateCompletion();
      showStep(4);
      await saveDraft({ silent: false });
      recoveryStatus.textContent = "استُعيدت حزمة J1 للمراجعة النهائية.";
      recoveryStatus.className = "status success";
      return;
    }
    if (unpacked.kind === "ratification-artifact") {
      validatePacket(unpacked.packet);
      await computeRatificationMerkleRoot(
        unpacked.primaryArtifact,
        unpacked.ratification
      );
      const roleControl = document.querySelector(
        'input[name="role"][value="ratification"]'
      );
      roleControl.checked = true;
      syncRoleControls();
      state.currentTaskVersionId = null;
      state.currentTaskLane = draftTaskLane({
        packet: unpacked.packet,
        role: "ratification"
      });
      state.packet = unpacked.packet;
      state.annotationA = null;
      state.annotationB = null;
      state.primaryArtifact = unpacked.primaryArtifact;
      await renderRatification();
      applyWorkspace([{
        kind: "ratification",
        primaryReceiptId: unpacked.ratification.primaryReceiptId,
        decision: unpacked.ratification.decision,
        rationale: unpacked.ratification.rationale
      }]);
      state.workspaceRevision += 1;
      renderPacketSummary("نسخة J2 مستردة");
      updateCompletion();
      showStep(4);
      await saveDraft({ silent: false });
      recoveryStatus.textContent =
        "استُعيد قرار J2 وحُفظ كمسودة جديدة. "
        + "سيُنشأ التعهّد من جلستك الحالية عند الإرسال.";
      recoveryStatus.className = "status success";
      return;
    }
    throw new Error(
      "الملف لا يحتوي تصديرًا أو مسودة صالحة للاسترداد."
    );
  } catch (error) {
    recoveryStatus.textContent = error.message;
    recoveryStatus.className = "status error";
  } finally {
    recoveryFile.value = "";
  }
}

function annotationWorkspaceFields(annotation) {
  return annotation.sentences.map(sentence => ({
    sentenceId: sentence.sentenceId,
    structural: String(sentence.structurallyAcceptable),
    predicate: String(sentence.completePredicate),
    sentenceResolution: "",
    tokens: sentence.tokens.map(token => ({
      tokenId: token.tokenId,
      upos: token.universalPartOfSpeech,
      head: String(token.headTokenId),
      relation: token.dependencyRelation,
      irabCategory: token.irabNotApplicable
        ? "_"
        : token.irabCategory,
      irabHead: token.irabHeadTokenId == null
        ? ""
        : String(token.irabHeadTokenId),
      note: token.note ?? "",
      resolution: ""
    }))
  }));
}

async function loadPilot() {
  clearStatus();
  try {
    const response = await fetch("/data/pilot-packet.json", {
      headers: { accept: "application/json" }
    });
    if (!response.ok) throw new Error("تعذر تحميل العينة التجريبية.");
    state.packet = await response.json();
    state.currentTaskVersionId = null;
    validatePacket(state.packet);
    state.currentTaskLane = inferLoadedPacketLane(
      state.packet,
      OPERATIONAL_TEST_REQUESTED
    );
    renderPacketSummary("العينة التجريبية الجاهزة");
  } catch (error) {
    showStatus(
      `${error.message} يمكنك استخدام ملف الحزمة من منسق التقييم.`,
      true
    );
  }
}

async function loadPacketFile() {
  clearStatus();
  try {
    const loaded = await readJson(packetFile.files[0], "حزمة النص");
    state.packet = unpackPortalFile(loaded).packet;
    state.currentTaskVersionId = null;
    validatePacket(state.packet);
    state.currentTaskLane = inferLoadedPacketLane(
      state.packet,
      OPERATIONAL_TEST_REQUESTED
    );
    renderPacketSummary("حزمة منسق التقييم");
  } catch (error) {
    state.packet = null;
    packetSummary.hidden = true;
    showStatus(error.message, true);
  }
}

function renderPacketSummary(sourceLabel) {
  const tokenCount = state.packet.sentences
    .reduce((sum, sentence) => sum + sentence.tokens.length, 0);
  packetSummary.innerHTML = `
    <dl>
      <div><dt>المصدر</dt><dd>${escapeHtml(sourceLabel)}</dd></div>
      <div><dt>الجمل</dt><dd>${state.packet.sentences.length}</dd></div>
      <div><dt>الوحدات</dt><dd>${tokenCount}</dd></div>
      <div><dt>الحالة</dt><dd>عمياء بلا توقعات</dd></div>
    </dl>`;
  packetSummary.hidden = false;
}

async function prepareCase() {
  if (!state.packet) {
    throw new Error("حمّل العينة التجريبية أو حزمة منسق التقييم أولًا.");
  }
  validatePacket(state.packet);
  const role = selectedRole();
  if (role === "adjudication") {
    state.primaryArtifact = null;
    const loadedA = await readJson(
      annotationAFile.files[0],
      "ملف المعلّق A"
    );
    const loadedB = await readJson(
      annotationBFile.files[0],
      "ملف المعلّق B"
    );
    state.annotationA = unpackPortalFile(loadedA).annotation;
    state.annotationB = unpackPortalFile(loadedB).annotation;
    await validateSubmissionBinding(state.packet, state.annotationA);
    await validateSubmissionBinding(state.packet, state.annotationB);
    if (state.annotationA.annotatorSlot === state.annotationB.annotatorSlot) {
      throw new Error("ملفا التعليق يحملان الدور نفسه.");
    }
    renderAdjudication();
  } else if (role === "ratification") {
    state.annotationA = null;
    state.annotationB = null;
    const loaded = await readJson(
      primaryAdjudicationFile.files[0],
      "حزمة التحكيم الأولية"
    );
    state.primaryArtifact = loaded?.artifact ?? loaded;
    if (!state.primaryArtifact
        || state.primaryArtifact.kind !== "adjudication-package") {
      throw new Error("الملف لا يحتوي حزمة تحكيم أولية صالحة من J1.");
    }
    const sourceRoot = await computePacketMerkleRoot(
      state.primaryArtifact.packet
    );
    const selectedRoot = await computePacketMerkleRoot(state.packet);
    if (sourceRoot !== selectedRoot) {
      throw new Error("حزمة J1 لا تخص نسخة المهمة المحمّلة.");
    }
    await computeAdjudicationMerkleRoot(
      state.primaryArtifact.packet,
      state.primaryArtifact.annotationA,
      state.primaryArtifact.annotationB,
      state.primaryArtifact.adjudication
    );
    await renderRatification();
  } else {
    state.annotationA = null;
    state.annotationB = null;
    state.primaryArtifact = null;
    renderAnnotation();
  }
  updateCompletion();
}

async function saveDraft(options = {}) {
  const silent = options?.silent === true;
  if (!silent) setDraftStatus("", false);
  if (!state.packet) {
    if (!silent) setDraftStatus("لا توجد مهمة محمّلة لحفظها.", true);
    return false;
  }
  const revision = state.workspaceRevision;
  const draft = createDraftSnapshot();
  persistLocalDraft(draft);
  if (!state.account.authenticated) {
    setDraftStatus(
      "حُفظت نسخة استرداد على هذا الجهاز. سجّل الدخول لمزامنتها مشفّرةً.",
      false
    );
    return true;
  }
  if (state.draftSavePromise) {
    await state.draftSavePromise;
    return state.serverDraftRevision >= revision;
  }
  state.draftSaving = true;
  saveDraftButton.disabled = true;
  state.draftSavePromise = apiJson("/api/draft", {
    method: "PUT",
    body: {
      packetId: state.packet.packetId,
      role: selectedRole(),
      draft
    }
  });
  try {
    const result = await state.draftSavePromise;
    state.serverDraftRevision = Math.max(
      state.serverDraftRevision,
      revision
    );
    setDraftStatus(
      `${silent ? "حفظ تلقائي" : "حُفظت المسودة بأمان"} · `
        + `${result.progressPercent}% · ${formatDate(result.updatedAtUtc)}`
        + `${result.revisionPreserved ? " · حُفظت النسخة السابقة" : ""}.`,
      false
    );
    if (!silent) await refreshDraftList();
    return true;
  } catch (error) {
    setDraftStatus(
      `حُفظت نسخة الاسترداد على هذا الجهاز، وتعذرت مزامنة الخادم: `
        + error.message,
      true
    );
    return false;
  } finally {
    state.draftSavePromise = null;
    state.draftSaving = false;
    saveDraftButton.disabled = false;
  }
}

function createDraftSnapshot(savedAtUtc = new Date().toISOString()) {
  return {
    schema: "adg-msa-portal-draft-v1",
    savedAtUtc,
    participantId: state.participantId,
    role: selectedRole(),
    taskVersionId: state.currentTaskVersionId,
    taskLane: state.currentTaskLane,
    packet: state.packet,
    annotationA: state.annotationA,
    annotationB: state.annotationB,
    primaryArtifact: state.primaryArtifact,
    fields: captureWorkspace()
  };
}

function scheduleAutosave() {
  if (state.autosaveTimer) clearTimeout(state.autosaveTimer);
  if (!state.packet || ![4, 5].includes(state.step)) {
    return;
  }
  state.autosaveTimer = setTimeout(() => {
    state.autosaveTimer = null;
    void saveDraft({ silent: true });
  }, 5000);
}

async function flushDraftSave() {
  if (!state.packet) return;
  if (state.autosaveTimer) {
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = null;
  }
  persistCurrentDraftLocally();
  if (state.draftSavePromise) {
    await state.draftSavePromise.catch(() => null);
  }
  if (state.serverDraftRevision < state.workspaceRevision) {
    await saveDraft({ silent: true });
  }
}

function flushDraftOnPageHide() {
  if (!state.packet || ![4, 5].includes(state.step)) return;
  const draft = createDraftSnapshot();
  persistLocalDraft(draft);
  if (!state.account.authenticated) return;
  const body = JSON.stringify({
    packetId: state.packet.packetId,
    role: selectedRole(),
    draft
  });
  void fetch("/api/draft", {
    method: "PUT",
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body,
    keepalive: true
  });
}

function persistCurrentDraftLocally() {
  if (!state.packet || !workspace.children.length) return;
  persistLocalDraft(createDraftSnapshot());
}

function persistLocalDraft(draft) {
  try {
    localStorage.setItem(
      localDraftKey(draft.packet.packetId, draft.role),
      JSON.stringify(draft)
    );
  } catch {
    // The server draft remains the primary durable copy.
  }
}

function readLocalDraft(packetId, role) {
  try {
    const value = localStorage.getItem(localDraftKey(packetId, role));
    if (!value) return null;
    const draft = JSON.parse(value);
    return draft?.schema === "adg-msa-portal-draft-v1"
      ? draft
      : null;
  } catch {
    return null;
  }
}

function listLocalDrafts() {
  const owner = localDraftOwner();
  const prefix = `adg-portal-draft-v1:${owner}:`;
  const drafts = [];
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = JSON.parse(localStorage.getItem(key));
      if (draft?.schema === "adg-msa-portal-draft-v1") drafts.push(draft);
    }
  } catch {
    return [];
  }
  return drafts;
}

function localDraftKey(packetId, role) {
  return `adg-portal-draft-v1:${localDraftOwner()}:${packetId}:${role}`;
}

function localDraftOwner() {
  return state.account.userId || state.participantId;
}

async function refreshDraftList() {
  draftList.replaceChildren();
  if (!state.account.authenticated) {
    savedDrafts.hidden = true;
    return;
  }
  try {
    const result = await apiJson("/api/drafts");
    const draftsByKey = new Map(
      (result.drafts || []).map(draft => [
        `${draft.packetId}:${draft.role}`,
        { ...draft, source: "server" }
      ])
    );
    for (const local of listLocalDrafts()) {
      const key = `${local.packet.packetId}:${local.role}`;
      const existing = draftsByKey.get(key);
      if (!existing
          || Date.parse(local.savedAtUtc) > Date.parse(existing.updatedAtUtc)) {
        draftsByKey.set(key, {
          packetId: local.packet.packetId,
          role: local.role,
          progressPercent: null,
          revisionCount: 0,
          updatedAtUtc: local.savedAtUtc,
          source: "local",
          draft: local
        });
      }
    }
    const drafts = [...draftsByKey.values()].sort(
      (left, right) =>
        Date.parse(right.updatedAtUtc) - Date.parse(left.updatedAtUtc)
    );
    savedDrafts.hidden = drafts.length === 0;
    drafts.forEach(draft => {
      const card = document.createElement("div");
      card.className = "draft-card";
      const details = document.createElement("div");
      const title = document.createElement("span");
      title.textContent =
        `${draft.packetId} — ${roleLabel(draft.role)}`;
      const timestamp = document.createElement("small");
      timestamp.textContent = `آخر حفظ: ${formatDate(draft.updatedAtUtc)}`;
      if (Number.isFinite(draft.progressPercent)) {
        timestamp.textContent += ` · ${draft.progressPercent}%`;
      }
      if (draft.revisionCount > 0) {
        timestamp.textContent += ` · ${draft.revisionCount} نسخة سابقة`;
      }
      if (draft.source === "local") {
        timestamp.textContent += " · محفوظة على هذا الجهاز";
      }
      details.append(title, timestamp);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "button secondary compact";
      button.textContent = "متابعة";
      button.addEventListener(
        "click",
        () => draft.source === "local"
          ? restoreDraftObject(draft.draft, "نسخة هذا الجهاز")
          : resumeDraft(draft.packetId, draft.role)
      );
      card.append(details, button);
      draftList.append(card);
    });
  } catch (error) {
    savedDrafts.hidden = true;
    if (error.status !== 401) showStatus(error.message, true);
  }
}

async function resumeDraft(packetId, role) {
  clearStatus();
  try {
    const query = new URLSearchParams({ packetId, role });
    const result = await apiJson(`/api/draft?${query}`);
    if (!result.found) {
      throw new Error("لم تعد هذه المسودة متاحة.");
    }
    await restoreDraftObject(result.draft, "مسودة محفوظة", role);
    setDraftStatus(
      `استُعيدت المسودة المحفوظة في ${formatDate(result.updatedAtUtc)}.`,
      false
    );
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function restoreDraftObject(draft, sourceLabel, expectedRole = null) {
  if (draft?.schema !== "adg-msa-portal-draft-v1"
      || (expectedRole && draft.role !== expectedRole)) {
    throw new Error("بنية المسودة المحفوظة غير صالحة.");
  }
  validatePacket(draft.packet);
  const roleControl = document.querySelector(
    `input[name="role"][value="${draft.role}"]`
  );
  if (!roleControl) throw new Error("دور المسودة غير مدعوم.");
  roleControl.checked = true;
  syncRoleControls();
  state.currentTaskVersionId = validTaskVersionId(draft.taskVersionId)
    ? draft.taskVersionId
    : null;
  state.currentTaskLane = draftTaskLane(draft);
  state.participantId = draft.participantId || state.participantId;
  state.packet = draft.packet;
  state.annotationA = draft.annotationA ?? null;
  state.annotationB = draft.annotationB ?? null;
  state.primaryArtifact = draft.primaryArtifact ?? null;

  if (draft.role === "adjudication") {
    if (!state.annotationA || !state.annotationB) {
      throw new Error("مدخلا A وB غير موجودين في المسودة.");
    }
    await validateSubmissionBinding(state.packet, state.annotationA);
    await validateSubmissionBinding(state.packet, state.annotationB);
    renderAdjudication();
  } else if (draft.role === "ratification") {
    if (!state.primaryArtifact) {
      throw new Error("حزمة J1 غير موجودة في المسودة.");
    }
    await renderRatification();
  } else {
    renderAnnotation();
  }
  applyWorkspace(draft.fields);
  state.workspaceRevision += 1;
  renderPacketSummary(sourceLabel);
  updateCompletion();
  showStep(4);
}

function draftTaskLane(draft) {
  if (["standard", "operational-test"].includes(draft?.taskLane)) {
    return draft.taskLane;
  }
  return draft?.packet?.packetId === BASELINE_PILOT_PACKET_ID
      && draft.packet.pilotOnly === true
      && ["A", "B"].includes(draft.role)
    ? "operational-test"
    : null;
}

function validTaskVersionId(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{2,200}$/u.test(value);
}

function captureWorkspace() {
  if (selectedRole() === "ratification") {
    return [{
      kind: "ratification",
      primaryReceiptId:
        controlValue(workspace, ".primary-receipt"),
      decision:
        controlValue(workspace, ".ratification-decision"),
      rationale:
        controlValue(workspace, ".ratification-rationale")
    }];
  }
  return [...workspace.querySelectorAll(".sentence")].map(sentence => ({
    sentenceId: sentence.dataset.sentenceId,
    structural: controlValue(sentence, "select.structural"),
    predicate: controlValue(sentence, "select.predicate"),
    sentenceResolution:
      controlValue(sentence, ".sentence-resolution input"),
    tokens: [...sentence.querySelectorAll(".token-card")].map(card => ({
      tokenId: card.dataset.tokenId,
      upos: controlValue(card, "select.upos"),
      head: controlValue(card, ".head"),
      relation: controlValue(card, "select.relation"),
      irabCategory: controlValue(card, "select.irab-category"),
      irabHead: controlValue(card, ".irab-head"),
      note: controlValue(card, ".note input"),
      resolution: controlValue(card, ".resolution input")
    }))
  }));
}

function applyWorkspace(fields) {
  if (selectedRole() === "ratification") {
    const saved = (fields || []).find(item => item.kind === "ratification");
    if (!saved) return;
    setControlValue(
      workspace,
      ".primary-receipt",
      saved.primaryReceiptId
    );
    setControlValue(
      workspace,
      ".ratification-decision",
      saved.decision
    );
    setControlValue(
      workspace,
      ".ratification-rationale",
      saved.rationale
    );
    return;
  }
  const sentenceStates = new Map(
    (fields || []).map(item => [String(item.sentenceId), item])
  );
  workspace.querySelectorAll(".sentence").forEach(sentence => {
    const saved = sentenceStates.get(String(sentence.dataset.sentenceId));
    if (!saved) return;
    setControlValue(sentence, "select.structural", saved.structural);
    setControlValue(sentence, "select.predicate", saved.predicate);
    setControlValue(
      sentence,
      ".sentence-resolution input",
      saved.sentenceResolution
    );
    const tokens = new Map(
      (saved.tokens || []).map(item => [String(item.tokenId), item])
    );
    sentence.querySelectorAll(".token-card").forEach(card => {
      const token = tokens.get(String(card.dataset.tokenId));
      if (!token) return;
      setControlValue(card, "select.upos", token.upos);
      setControlValue(card, ".head", token.head);
      setControlValue(card, "select.relation", token.relation);
      setControlValue(
        card,
        "select.irab-category",
        token.irabCategory
      );
      syncIrabHead(card.querySelector("select.irab-category"));
      setControlValue(card, ".irab-head", token.irabHead);
      setControlValue(card, ".note input", token.note);
      setControlValue(card, ".resolution input", token.resolution);
    });
  });
}

function controlValue(parent, selector) {
  return parent.querySelector(selector)?.value ?? "";
}

function setControlValue(parent, selector, valueToSet) {
  const control = parent.querySelector(selector);
  if (control) control.value = valueToSet ?? "";
}

function setDraftStatus(message, error) {
  draftStatus.textContent = message || "";
  draftStatus.className = `status${message
    ? error ? " error" : " success"
    : ""}`;
}

function formatDate(valueToFormat) {
  return new Intl.DateTimeFormat("ar-SA", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(valueToFormat));
}

function syncRoleControls() {
  adjudicationFiles.hidden = selectedRole() !== "adjudication";
  ratificationFiles.hidden = selectedRole() !== "ratification";
}

function renderAnnotation() {
  workspace.replaceChildren();
  state.packet.sentences.forEach(sentence => {
    workspace.append(createAnnotationSentence(sentence));
  });
}

function createAnnotationSentence(sentence) {
  const section = sentenceShell(sentence);
  const flags = document.createElement("div");
  flags.className = "sentence-flags";
  flags.append(
    labelled(
      "هل التركيب مقبول في العربية المعيارية؟",
      booleanSelect("structural")),
    labelled(
      "هل الإسناد مكتمل؟",
      booleanSelect("predicate"))
  );
  section.append(flags);
  const list = document.createElement("div");
  list.className = "token-list";
  sentence.tokens.forEach(token => {
    list.append(annotationTokenCard(token, sentence.tokens));
  });
  section.append(list);
  return section;
}

function annotationTokenCard(token, sentenceTokens) {
  const card = document.createElement("div");
  card.className = "token-card";
  card.dataset.tokenId = token.id;
  card.append(
    tokenForm(token),
    tokenSelectField("نوع الكلمة", "upos", UPOS),
    tokenReferenceField(
      "الرأس النحوي",
      "head",
      sentenceTokens,
      token.id,
      true
    ),
    tokenSelectField("العلاقة", "relation", RELATIONS),
    irabFields(sentenceTokens, token.id),
    textField("ملاحظة لغوية (اختياري)", "note")
  );
  return card;
}

function renderAdjudication() {
  workspace.replaceChildren();
  const aSentences = sentenceMap(state.annotationA.sentences);
  const bSentences = sentenceMap(state.annotationB.sentences);
  state.packet.sentences.forEach(sentence => {
    workspace.append(createAdjudicationSentence(
      sentence,
      aSentences.get(sentence.sentenceId),
      bSentences.get(sentence.sentenceId)
    ));
  });
}

async function renderRatification() {
  workspace.replaceChildren();
  const primaryRoot = await computeAdjudicationMerkleRoot(
    state.primaryArtifact.packet,
    state.primaryArtifact.annotationA,
    state.primaryArtifact.annotationB,
    state.primaryArtifact.adjudication
  );
  const heading = document.createElement("section");
  heading.className = "task-instructions";
  heading.innerHTML = `
    <strong>مراجعة مستقلة للجذر النهائي</strong>
    <p>
      راجع أدلة A وB وأسباب J1. لا تصبح النتيجة معتمدة إلا إذا وقّعت
      أنت الجذر نفسه دون تعديل.
    </p>
    <p dir="ltr"><code>${escapeHtml(primaryRoot)}</code></p>`;
  workspace.append(heading);
  workspace.append(createResultCard({
    receiptId: "primary-adjudication",
    participantPseudonym:
      state.primaryArtifact.adjudication.adjudicatorPseudonym,
    role: "adjudication",
    isFinal: false,
    githubStatus: "awaiting-j2",
    submittedAtUtc: new Date().toISOString(),
    artifactSha256: await sha256Json(state.primaryArtifact),
    artifact: state.primaryArtifact
  }));

  const controls = document.createElement("section");
  controls.className = "ratification-controls";
  controls.innerHTML = `
    <label>
      معرف استلام حزمة J1
      <input class="primary-receipt" dir="ltr" autocomplete="off"
             placeholder="00000000-0000-4000-8000-000000000000">
    </label>
    <label>
      قرار المراجع J2
      <select class="ratification-decision">
        <option value="">اختر القرار</option>
        <option value="agree">أوافق على الجذر النهائي نفسه</option>
        <option value="disagree">أعترض وأطلب التصعيد</option>
        <option value="recuse">أتنحى لتعارض مصالح</option>
      </select>
    </label>
    <label>
      التعليل العلمي <small>(20 حرفًا على الأقل)</small>
      <textarea class="ratification-rationale" rows="5"
                maxlength="4000"></textarea>
    </label>`;
  workspace.append(controls);
}

function createAdjudicationSentence(source, annotationA, annotationB) {
  const section = sentenceShell(source);
  const flags = document.createElement("div");
  flags.className = "sentence-flags";
  flags.append(
    labelled(
      `سلامة التركيب — A: ${yesNo(annotationA.structurallyAcceptable)}، `
        + `B: ${yesNo(annotationB.structurallyAcceptable)}`,
      booleanSelect(
        "structural",
        annotationA.structurallyAcceptable)),
    labelled(
      `اكتمال الإسناد — A: ${yesNo(annotationA.completePredicate)}، `
        + `B: ${yesNo(annotationB.completePredicate)}`,
      booleanSelect(
        "predicate",
        annotationA.completePredicate)),
    textField("سبب حسم خلاف الجملة عند الحاجة", "sentence-resolution")
  );
  section.append(flags);
  const aTokens = tokenMap(annotationA.tokens);
  const bTokens = tokenMap(annotationB.tokens);
  const list = document.createElement("div");
  list.className = "token-list";
  source.tokens.forEach(token => {
    list.append(adjudicationTokenCard(
      token,
      source.tokens,
      aTokens.get(token.id),
      bTokens.get(token.id)
    ));
  });
  section.append(list);
  return section;
}

function adjudicationTokenCard(
  source,
  sentenceTokens,
  annotationA,
  annotationB
) {
  const card = document.createElement("div");
  const differs = tokenDecisionKey(annotationA) !== tokenDecisionKey(annotationB);
  card.className = `token-card${differs ? " difference" : ""}`;
  card.dataset.tokenId = source.id;
  const comparison = document.createElement("div");
  comparison.className = "comparison-box";
  comparison.innerHTML = `
    <code><strong>A</strong>\n${escapeHtml(tokenSummary(annotationA))}</code>
    <code><strong>B</strong>\n${escapeHtml(tokenSummary(annotationB))}</code>`;
  const resolution = textField(
    "سبب الحسم أو تغيير اتفاق المعلّقين",
    "resolution"
  );
  resolution.classList.add("resolution");
  card.append(
    tokenForm(source),
    tokenSelectField(
      "القرار النهائي: نوع الكلمة",
      "upos",
      UPOS,
      annotationA.universalPartOfSpeech),
    tokenReferenceField(
      "القرار النهائي: الرأس",
      "head",
      sentenceTokens,
      source.id,
      true,
      annotationA.headTokenId),
    tokenSelectField(
      "القرار النهائي: العلاقة",
      "relation",
      RELATIONS,
      annotationA.dependencyRelation),
    irabFields(
      sentenceTokens,
      source.id,
      annotationA.irabNotApplicable
        ? "_"
        : annotationA.irabCategory,
      annotationA.irabHeadTokenId),
    comparison,
    resolution
  );
  return card;
}

async function validateWorkspace() {
  if (selectedRole() === "adjudication") {
    await collectAdjudication(false);
  } else if (selectedRole() === "ratification") {
    await collectRatification(false);
  } else {
    await collectAnnotation(false);
  }
}

async function buildArtifactBundle() {
  validateAttestations();
  const role = selectedRole();
  if (role === "adjudication") {
    const decision = await collectAdjudication(true);
    await computeAdjudicationMerkleRoot(
      state.packet,
      state.annotationA,
      state.annotationB,
      decision
    );
    return {
      schema: "adg-msa-portal-artifact-v1",
      kind: "adjudication-package",
      packet: state.packet,
      annotationA: state.annotationA,
      annotationB: state.annotationB,
      adjudication: decision
    };
  }
  if (role === "ratification") {
    const ratification = await collectRatification(true);
    await computeRatificationMerkleRoot(
      state.primaryArtifact,
      ratification
    );
    return {
      schema: "adg-msa-portal-artifact-v1",
      kind: "ratification-package",
      primaryArtifact: state.primaryArtifact,
      ratification
    };
  }

  const annotation = await collectAnnotation(true);
  await computeAnnotationMerkleRoot(state.packet, annotation);
  return {
    schema: "adg-msa-portal-artifact-v1",
    kind: "independent-annotation",
    packet: state.packet,
    annotation
  };
}

async function collectRatification(finalize) {
  if (!state.primaryArtifact) {
    throw new Error("حمّل حزمة J1 قبل المراجعة الثانية.");
  }
  const primaryReceiptId = workspace
    .querySelector(".primary-receipt")?.value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(primaryReceiptId || "")) {
    throw new Error("أدخل معرف استلام حزمة J1 الصحيح.");
  }
  const decision = workspace
    .querySelector(".ratification-decision")?.value;
  if (!["agree", "disagree", "recuse"].includes(decision)) {
    throw new Error("اختر قرار المراجع J2.");
  }
  const rationale = workspace
    .querySelector(".ratification-rationale")?.value.trim() || "";
  if (rationale.length < 20) {
    throw new Error("اكتب تعليلًا علميًا من 20 حرفًا على الأقل.");
  }
  const packet = state.primaryArtifact.packet;
  return {
    schema: RATIFICATION_SCHEMA,
    taskId: packet.taskId,
    taskVersion: packet.taskVersion,
    packetId: packet.packetId,
    holdoutId: packet.holdoutId,
    protocolVersion: packet.protocolVersion,
    packetMerkleRoot: await computePacketMerkleRoot(packet),
    primaryReceiptId,
    primaryAdjudicationMerkleRoot:
      await computeAdjudicationMerkleRoot(
        packet,
        state.primaryArtifact.annotationA,
        state.primaryArtifact.annotationB,
        state.primaryArtifact.adjudication
      ),
    reviewerSlot: "J2",
    reviewerPseudonym:
      `human-${state.participantId.slice(0, 12)}-J2`,
    reviewerIsHuman: true,
    reviewerIsSynthetic: false,
    independentFromImplementationTeam:
      finalize && checked("attest-independent"),
    decision,
    rationale
  };
}

async function collectAnnotation(finalize) {
  const slot = selectedRole();
  const operationalTest = operationalTestMode();
  const sentences = [...workspace.querySelectorAll(".sentence")]
    .map(section => ({
      sentenceId: section.dataset.sentenceId,
      structurallyAcceptable:
        requiredBoolean(section.querySelector(".structural")),
      completePredicate:
        requiredBoolean(section.querySelector(".predicate")),
      tokens: [...section.querySelectorAll(".token-card")]
        .map(card => collectToken(card, false)),
      note: null
    }));
  return {
    schema: ANNOTATION_SCHEMA,
    taskId: state.packet.taskId,
    taskVersion: state.packet.taskVersion,
    packetId: state.packet.packetId,
    holdoutId: state.packet.holdoutId,
    protocolId: state.packet.protocolId,
    guidelineVersion: state.packet.guidelineVersion,
    dataVersion: state.packet.dataVersion,
    protocolVersion: state.packet.protocolVersion,
    packetMerkleRoot: await computePacketMerkleRoot(state.packet),
    annotatorSlot: slot,
    annotatorPseudonym: `human-${state.participantId.slice(0, 12)}-${slot}`,
    isHuman: true,
    isSynthetic: false,
    independentFromImplementationTeam:
      operationalTest ? false : finalize && checked("attest-independent"),
    blindToParserInternals:
      operationalTest ? false : finalize && checked("attest-blind"),
    parserPredictionsViewed: false,
    sentences
  };
}

async function collectAdjudication(finalize) {
  const aBySentence = sentenceMap(state.annotationA.sentences);
  const bBySentence = sentenceMap(state.annotationB.sentences);
  const sentences = [...workspace.querySelectorAll(".sentence")]
    .map(section => {
      const sentenceId = section.dataset.sentenceId;
      const annotationA = aBySentence.get(sentenceId);
      const annotationB = bBySentence.get(sentenceId);
      const structural = requiredBoolean(
        section.querySelector(".structural"));
      const predicate = requiredBoolean(
        section.querySelector(".predicate"));
      const sentenceNote = nullable(
        section.querySelector("input.sentence-resolution").value);
      if ((decisionNeedsResolution(
            annotationA.structurallyAcceptable,
            annotationB.structurallyAcceptable,
            structural)
          || decisionNeedsResolution(
            annotationA.completePredicate,
            annotationB.completePredicate,
            predicate))
          && !sentenceNote) {
        throw new Error(
          `اكتب سبب حسم قرار الجملة ${sentenceId}.`);
      }

      const aTokens = tokenMap(annotationA.tokens);
      const bTokens = tokenMap(annotationB.tokens);
      const tokens = [...section.querySelectorAll(".token-card")]
        .map(card => {
          const finalToken = collectToken(card, true);
          const tokenA = aTokens.get(finalToken.tokenId);
          const tokenB = bTokens.get(finalToken.tokenId);
          if (decisionNeedsResolution(
                tokenDecisionKey(tokenA),
                tokenDecisionKey(tokenB),
                tokenDecisionKey(finalToken))
              && !finalToken.resolutionNote) {
            throw new Error(
              `اكتب سبب حسم الوحدة ${finalToken.tokenId} `
              + `في الجملة ${sentenceId}.`);
          }
          return finalToken;
        });
      return {
        sentenceId,
        structurallyAcceptable: structural,
        completePredicate: predicate,
        tokens,
        resolutionNote: sentenceNote
      };
    });
  return {
    schema: ADJUDICATION_SCHEMA,
    taskId: state.packet.taskId,
    taskVersion: state.packet.taskVersion,
    packetId: state.packet.packetId,
    holdoutId: state.packet.holdoutId,
    protocolId: state.packet.protocolId,
    guidelineVersion: state.packet.guidelineVersion,
    dataVersion: state.packet.dataVersion,
    protocolVersion: state.packet.protocolVersion,
    packetMerkleRoot: await computePacketMerkleRoot(state.packet),
    annotationAMerkleRoot:
      await computeAnnotationMerkleRoot(state.packet, state.annotationA),
    annotationBMerkleRoot:
      await computeAnnotationMerkleRoot(state.packet, state.annotationB),
    annotationASlot: state.annotationA.annotatorSlot,
    annotationBSlot: state.annotationB.annotatorSlot,
    adjudicatorSlot: "J1",
    adjudicatorPseudonym: `human-${state.participantId.slice(0, 12)}-J1`,
    adjudicatorIsHuman: true,
    adjudicatorIsSynthetic: false,
    independentFromImplementationTeam:
      finalize && checked("attest-independent"),
    blindToParserInternals: finalize && checked("attest-blind"),
    parserPredictionsViewed: false,
    sentences
  };
}

function collectToken(card, adjudicated) {
  const category = requiredControl(
    card,
    ".irab-category",
    "قرار الإعراب"
  );
  const notApplicable = category === "_";
  const token = {
    tokenId: Number(card.dataset.tokenId),
    universalPartOfSpeech: requiredControl(card, ".upos", "نوع الكلمة"),
    headTokenId: integerControl(card, ".head", "الرأس النحوي"),
    dependencyRelation:
      requiredControl(card, ".relation", "العلاقة النحوية"),
    irabHeadTokenId: notApplicable
      ? null
      : integerControl(card, ".irab-head", "رأس علاقة الإعراب"),
    irabCategory: notApplicable ? null : category,
    irabNotApplicable: notApplicable
  };
  if (adjudicated) {
    token.resolutionNote = nullable(
      card.querySelector(".resolution input").value);
  } else {
    token.note = nullable(card.querySelector(".note input").value);
  }
  return token;
}

function renderReview() {
  const role = selectedRole();
  const operationalTest = operationalTestMode();
  if (OPERATIONAL_TEST_REQUESTED && !operationalTest) {
    throw new Error(
      "وضع الاختبار التشغيلي متاح للحزمة التجريبية ولدوري A أو B فقط."
    );
  }
  const tokenCount = state.packet.sentences
    .reduce((sum, sentence) => sum + sentence.tokens.length, 0);
  attestIndependentLabel.textContent = operationalTest
    ? "أقرّ بأن هذه تجربة تشغيلية مُساعَدة وليست تحكيمًا مستقلًا."
    : "أنجزتُ التقييم باستقلال عن فريق تطوير المحلّل.";
  attestBlindLabel.textContent = operationalTest
    ? "أقرّ بأنني استعنت بمراجعة مرجعية، ولذلك لا تُعد النتيجة معماة."
    : "لم أطّلع على مُخرَجات المحلّل أو إجاباته قبل الإكمال.";
  attestAuthenticLabel.textContent = operationalTest
    ? "القيم المسجَّلة هي التي أريد استخدامها لاختبار مسار النشر."
    : "القرارات المسجَّلة تمثّل حكمي اللغوي الحقيقي.";
  reviewSummary.innerHTML = `
    <dl>
      <div><dt>الدور</dt><dd>${escapeHtml(
        operationalTest ? roleLabel("operational-test") : roleLabel(role)
      )}</dd></div>
      <div><dt>الجمل</dt><dd>${state.packet.sentences.length}</dd></div>
      <div><dt>الوحدات</dt><dd>${tokenCount}</dd></div>
      <div><dt>طريقة النشر</dt><dd>${
        operationalTest
          ? "تجربة مجهّلة لا تدخل الإجماع"
          : "نتيجة مجهّلة"
      }</dd></div>
    </dl>
    <p>
      راجع التعهدات أدناه. سيُحفظ اسمك وبريدك وحسابات التواصل التي
      أضفتها في Azure منفصلة، بينما تُرسل القرارات اللغوية إلى قناة
      الاستيراد الخاصة بالمستودع.
    </p>
    ${operationalTest
      ? `<p class="flash-banner warning">
          لن يشغل هذا الاختبار مقعد A أو B، ولن يُستخدم دليلًا على
          الجاهزية اللغوية.
        </p>`
      : ""}`;
}

function validateAttestations() {
  if (!checked("attest-independent")
      || !checked("attest-blind")
      || !checked("attest-authentic")) {
    throw new Error("يجب تأكيد التعهدات الثلاثة قبل الحفظ أو الإرسال.");
  }
}

async function downloadEvaluation() {
  clearStatus();
  try {
    const artifact = await buildArtifactBundle();
    downloadJson(
      `${state.packet.packetId}-${selectedRole()}-${state.participantId}.json`,
      {
        participantId: state.participantId,
        exportedAtUtc: new Date().toISOString(),
        artifact
      }
    );
    showStatus("حُفظت نسخة مجهّلة على جهازك.", false);
  } catch (error) {
    showStatus(error.message, true);
  }
}

async function submitEvaluation() {
  clearStatus();
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "جارٍ الإرسال…";
  showPendingStatus(
    "جارٍ تثبيت استلام المهمة وإرسال النتيجة. لا تغلق الصفحة."
  );
  try {
    validateProfile();
    if (!state.account.authenticated) {
      throw new Error("سجّل الدخول قبل إرسال التقييم.");
    }
    if ((OPERATIONAL_TEST_REQUESTED
          || state.currentTaskLane === "operational-test")
        && !operationalTestMode()) {
      throw new Error(
        "العينة التشغيلية المعزولة تقبل دورَي A وB فقط، "
        + "ولا يمكن إرسالها إلى مسار الإجماع."
      );
    }
    const artifact = await buildArtifactBundle();
    const artifactSha256 = await sha256Json(artifact);
    const turnstileToken = getTurnstileToken();
    const operationalTest = operationalTestMode();
    if (!state.config.submissionEnabled) {
      throw new Error(
        "الإرسال المركزي غير مفعّل بعد. احفظ نسخة الجهاز وأرسلها لمنسق "
        + "التقييم حتى تكتمل تهيئة قناة النشر الآمنة.");
    }
    if (!turnstileToken) {
      throw new Error("أكمل اختبار الحماية قبل الإرسال.");
    }

    const payload = {
      schema: "adg-msa-portal-submission-v1",
      participantId: state.participantId,
      submittedAtUtc: new Date().toISOString(),
      profile: accountProfile(),
      consent: accountConsent(),
      attestation: {
        independent: operationalTest
          ? false
          : checked("attest-independent"),
        blind: operationalTest ? false : checked("attest-blind"),
        authentic: checked("attest-authentic")
      },
      submissionMode: operationalTest ? "operational-test" : "standard",
      artifactType: artifact.kind,
      artifactSha256,
      artifact,
      clientVersion: `adg-v${PORTAL_VERSION}`,
      turnstileToken
    };
    const body = JSON.stringify(payload);
    if (new TextEncoder().encode(body).length
        > state.config.maxSubmissionBytes) {
      throw new Error("حجم التقييم أكبر من الحد المسموح لهذه الجولة.");
    }

    const response = await fetch(
      operationalTest ? "/api/operational-tests" : "/api/submissions",
      {
      method: "POST",
      headers: { "content-type": "application/json" },
      body
      }
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.message || "تعذر إرسال التقييم.");
    }
    const successMessage = operationalTest
      ? `${result.duplicate ? "سبق استلام" : "تم استلام"} `
        + `الاختبار التشغيلي برقم ${result.receiptId}. `
        + "سيظهر في المستودع موسومًا بأنه غير مستقل ولا يدخل الإجماع."
      : `تم استلام تقييمك برقم ${result.receiptId}. `
        + "ستظهر النتيجة المجهّلة في المستودع بعد الفحص الآلي.";
    showStatus(successMessage, false);
    const followUp = await Promise.allSettled([
      loadDiscussion(result.receiptId),
      refreshTaskInbox()
    ]);
    if (followUp.some(result => result.status === "rejected")) {
      showStatus(
        `${successMessage} تم الإرسال، لكن تعذر تحديث العرض الآن؛ `
          + "حدّث الصفحة لعرض الحالة المحفوظة.",
        false
      );
    }
  } catch (error) {
    showStatus(error.message, true);
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "إرسال التقييم بأمان";
    resetTurnstile();
  }
}

async function loadDiscussion(receiptId) {
  const query = new URLSearchParams({ receiptId });
  const data = await apiJson(`/api/results?${query}`);
  state.discussion.sourceReceiptId = receiptId;
  state.discussion.data = data;
  state.discussion.replyTo = null;
  discussionPanel.hidden = false;
  renderPreviousResults(data);
  renderDiscussionThread(data.comments || []);
  populateDiscussionControls(data.results || []);
  discussionComposer.hidden = data.operationalTest === true;
  if (data.operationalTest) {
    state.discussion.taskStatus = null;
    taskConsensusStatus.textContent =
      "تجربة تشغيلية معزولة؛ لا تشغل أي دور في آلة الإجماع.";
    appealPanel.hidden = true;
  } else {
    await loadTaskStatus(data.source.receiptId);
  }
  clearDiscussionReply();
  const currentUrl = new URL(location.href);
  currentUrl.searchParams.set("discussion", receiptId);
  history.replaceState(null, "", currentUrl);
  discussionPanel.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function loadTaskStatus(receiptId) {
  try {
    const query = new URLSearchParams({ receiptId });
    const status = await apiJson(`/api/tasks/status?${query}`);
    state.discussion.taskStatus = status.found ? status : null;
    renderTaskStatus(status);
  } catch (error) {
    state.discussion.taskStatus = null;
    taskConsensusStatus.textContent =
      `تعذر تحميل حالة الإجماع: ${error.message}`;
    appealPanel.hidden = true;
  }
}

function renderTaskStatus(status) {
  if (!status.found) {
    taskConsensusStatus.textContent =
      "هذه نتيجة قديمة لا ترتبط بعد بآلة الإجماع الرسمية.";
    appealPanel.hidden = true;
    return;
  }
  const submittedRoles = new Set(
    status.slots
      .filter(slot => slot.status === "submitted")
      .map(slot => slot.role)
  );
  const roleProgress = ["A", "B", "J1", "J2"]
    .map(role => `${role}: ${submittedRoles.has(role) ? "مكتمل" : "منتظر"}`)
    .join(" · ");
  const agreement = status.agreement
    ? ` · الاتفاق الخام ${formatMetric(
      status.agreement.macroRawAgreement
    )}`
      + ` · كابا ${status.agreement.macroDefinedKappa !== null
        ? formatMetric(status.agreement.macroDefinedKappa)
        : "غير معرّفة"}`
    : "";
  taskConsensusStatus.textContent =
    `الحالة: ${consensusStateLabel(status.state)} · `
    + `الجولة ${status.round.number} · ${roleProgress}${agreement}`;

  const deadline = status.appealDeadlineAtUtc
    ? Date.parse(status.appealDeadlineAtUtc)
    : 0;
  const pendingAppeal = status.appeals
    .some(appeal => appeal.status === "pending");
  const canAppeal = status.state === "approved"
    && Boolean(status.activeFinalReceiptId)
    && deadline > Date.now()
    && !pendingAppeal;
  appealPanel.hidden = !canAppeal;
  if (pendingAppeal) {
    taskConsensusStatus.textContent +=
      " · يوجد استئناف موثق قيد المراجعة.";
  } else if (status.state === "approved" && deadline > Date.now()) {
    taskConsensusStatus.textContent +=
      ` · تنتهي مهلة الاستئناف ${formatDate(
        status.appealDeadlineAtUtc
      )}.`;
  }
}

function consensusStateLabel(value) {
  return {
    draft: "مسودة",
    open: "مفتوحة",
    "independent-review": "تحكيم مستقل",
    discussion: "نقاش علمي",
    "final-review": "مراجعة J2",
    approved: "معتمدة مؤقتًا",
    published: "منشورة",
    escalated: "مصعّدة",
    reissued: "معاد طرحها",
    revoked: "مسحوبة",
    failed: "مغلقة دون إجازة"
  }[value] || value;
}

function formatMetric(value) {
  return Number.isFinite(Number(value))
    ? Number(value).toFixed(3)
    : "—";
}

async function submitConsensusAppeal() {
  const status = state.discussion.taskStatus;
  const evidence = appealEvidence.value.trim();
  if (!status?.activeFinalReceiptId) {
    setAppealStatus("لا توجد نتيجة نهائية قابلة للاستئناف.", true);
    return;
  }
  if (evidence.length < 40) {
    setAppealStatus(
      "اكتب دليلًا محددًا من 40 حرفًا على الأقل.",
      true
    );
    return;
  }
  submitAppealButton.disabled = true;
  setAppealStatus("", false);
  try {
    const result = await apiJson(
      "/api/consensus/appeals",
      {
        method: "POST",
        body: {
          finalReceiptId: status.activeFinalReceiptId,
          evidence
        }
      }
    );
    appealEvidence.value = "";
    setAppealStatus(
      `سُجل الاستئناف برقم ${result.appealId}.`,
      false
    );
    await loadTaskStatus(status.sourceReceiptId);
  } catch (error) {
    setAppealStatus(error.message, true);
  } finally {
    submitAppealButton.disabled = false;
  }
}

function setAppealStatus(message, error) {
  appealStatus.textContent = message;
  appealStatus.className =
    `status ${message ? (error ? "error" : "success") : ""}`;
}

function renderPreviousResults(data) {
  previousResults.replaceChildren();
  const heading = document.createElement("div");
  heading.className = "task-discussion-summary";
  heading.innerHTML = `
    <strong>المهمة ${escapeHtml(data.source.packetId)}</strong>
    <span>معرفك في هذه الجولة:
      <code>${escapeHtml(data.source.participantPseudonym)}</code>
    </span>`;
  previousResults.append(heading);
  if (!data.results.length) {
    const empty = document.createElement("p");
    empty.className = "empty-discussion";
    empty.textContent =
      "أنت أول مساهم مكتمل في هذه المهمة. ستظهر النتائج اللاحقة هنا "
      + "عند عودتك إلى رابط النقاش.";
    previousResults.append(empty);
    return;
  }
  data.results.forEach(result => {
    previousResults.append(createResultCard(result));
  });
}

function createResultCard(result) {
  const card = document.createElement("article");
  card.className = `result-card${result.isFinal ? " final" : ""}`;
  card.id = `result-${result.receiptId}`;

  const header = document.createElement("div");
  header.className = "result-card-header";
  const title = document.createElement("h6");
  title.textContent = result.participantPseudonym;
  const badges = document.createElement("div");
  badges.className = "result-badges";
  badges.append(
    resultBadge(roleLabel(result.role)),
    resultBadge(
      result.role === "operational-test"
        ? "تجربة تشغيلية"
        : result.isFinal ? "نتيجة نهائية" : "تحكيم مستقل"
    ),
    resultBadge(
      result.githubStatus === "pending-validation"
        ? "قيد مراجعة GitHub"
        : result.githubStatus
    )
  );
  header.append(title, badges);
  card.append(header);

  const meta = document.createElement("p");
  meta.className = "result-meta";
  meta.textContent =
    `${formatDate(result.submittedAtUtc)} · SHA-256 `
    + result.artifactSha256.slice(0, 16);
  card.append(meta);

  const decision = result.artifact.kind === "adjudication-package"
    ? result.artifact.adjudication
    : result.artifact.kind === "ratification-package"
      ? result.artifact.primaryArtifact.adjudication
      : result.artifact.annotation;
  const packet = result.artifact.kind === "ratification-package"
    ? result.artifact.primaryArtifact.packet
    : result.artifact.packet;
  const packetSentences = new Map(
    packet.sentences
      .map(sentence => [sentence.sentenceId, sentence])
  );
  for (const sentence of decision.sentences || []) {
    const details = document.createElement("details");
    details.className = "result-sentence";
    const summary = document.createElement("summary");
    const source = packetSentences.get(sentence.sentenceId);
    summary.textContent =
      `${sentence.sentenceId}: ${source?.text || "جملة المهمة"}`;
    details.append(summary);

    const sentenceDecision = document.createElement("p");
    sentenceDecision.textContent =
      `سلامة التركيب: ${sentence.structurallyAcceptable ? "نعم" : "لا"} · `
      + `اكتمال الإسناد: ${sentence.completePredicate ? "نعم" : "لا"}`;
    details.append(sentenceDecision);
    if (sentence.resolutionNote || sentence.note) {
      const note = document.createElement("blockquote");
      note.textContent = sentence.resolutionNote || sentence.note;
      details.append(note);
    }

    const table = document.createElement("table");
    table.className = "result-table";
    table.innerHTML = `
      <thead><tr>
        <th>الكلمة</th><th>الصنف</th><th>الرأس</th>
        <th>العلاقة</th><th>الإعراب</th>
      </tr></thead>`;
    const tbody = document.createElement("tbody");
    const tokens = new Map(
      (source?.tokens || []).map(token => [token.id, token.form])
    );
    for (const token of sentence.tokens || []) {
      const row = document.createElement("tr");
      [
        tokens.get(token.tokenId) || token.tokenId,
        token.universalPartOfSpeech,
        token.headTokenId,
        token.dependencyRelation,
        token.irabNotApplicable
          ? "غير منطبق"
          : token.irabCategory
      ].forEach(valueToWrite => {
        const cell = document.createElement("td");
        cell.textContent = String(valueToWrite ?? "");
        row.append(cell);
      });
      tbody.append(row);
      if (token.resolutionNote || token.note) {
        const noteRow = document.createElement("tr");
        noteRow.className = "result-note-row";
        const noteCell = document.createElement("td");
        noteCell.colSpan = 5;
        noteCell.textContent = token.resolutionNote || token.note;
        noteRow.append(noteCell);
        tbody.append(noteRow);
      }
    }
    table.append(tbody);
    details.append(table);
    card.append(details);
  }
  return card;
}

function resultBadge(text) {
  const badge = document.createElement("span");
  badge.textContent = text;
  return badge;
}

function populateDiscussionControls(results) {
  discussionTarget.replaceChildren(
    optionElement("", "نقاش عام للمهمة")
  );
  discussionMentions.replaceChildren();
  discussionReferences.replaceChildren();
  results.forEach(result => {
    const label =
      `${result.participantPseudonym} · ${roleLabel(result.role)}`
      + `${result.isFinal ? " · نهائية" : ""}`;
    discussionTarget.append(optionElement(result.receiptId, label));
    discussionMentions.append(
      optionElement(result.receiptId, `@${label}`)
    );
    discussionReferences.append(
      optionElement(result.receiptId, label)
    );
  });
}

function optionElement(valueToWrite, label) {
  const option = document.createElement("option");
  option.value = valueToWrite;
  option.textContent = label;
  return option;
}

function renderDiscussionThread(comments) {
  discussionThread.replaceChildren();
  if (!comments.length) {
    const empty = document.createElement("p");
    empty.className = "empty-discussion";
    empty.textContent =
      "لا توجد مداخلات بعد. ابدأ بسؤال علمي أو اختلاف معلّل.";
    discussionThread.append(empty);
    return;
  }
  comments.forEach(comment => {
    const article = document.createElement("article");
    article.className = "discussion-comment";
    article.id = `comment-${comment.commentId}`;
    if (comment.parentCommentId) {
      article.dataset.parentCommentId = comment.parentCommentId;
    }
    const header = document.createElement("div");
    header.className = "discussion-comment-header";
    const author = document.createElement("strong");
    author.textContent = comment.participantPseudonym;
    const meta = document.createElement("span");
    meta.textContent =
      `${discussionCategoryLabel(comment.category)} · `
      + formatDate(comment.createdAtUtc);
    header.append(author, meta);
    const body = document.createElement("p");
    body.textContent = comment.body;
    article.append(header, body);

    if (comment.location?.sentenceId || comment.location?.tokenId) {
      const locationValue = document.createElement("small");
      locationValue.textContent = [
        comment.location.sentenceId
          ? `الجملة: ${comment.location.sentenceId}`
          : null,
        comment.location.tokenId
          ? `الوحدة: ${comment.location.tokenId}`
          : null
      ].filter(Boolean).join(" · ");
      article.append(locationValue);
    }
    const links = document.createElement("div");
    links.className = "discussion-links";
    for (const mention of comment.mentions || []) {
      const chip = document.createElement("code");
      chip.textContent = `@${mention.pseudonym}`;
      links.append(chip);
    }
    for (const reference of comment.resultReferences || []) {
      const link = document.createElement("a");
      link.href = `#result-${reference.receiptId}`;
      link.textContent =
        reference.isFinal
          ? `النتيجة النهائية ${reference.receiptId.slice(0, 8)}`
          : `النتيجة ${reference.receiptId.slice(0, 8)}`;
      links.append(link);
    }
    if (links.childElementCount) article.append(links);

    const reply = document.createElement("button");
    reply.className = "button ghost discussion-reply";
    reply.type = "button";
    reply.textContent = "رد";
    reply.addEventListener("click", () => {
      state.discussion.replyTo = comment.commentId;
      replyContext.hidden = false;
      replyContextText.textContent =
        `رد على ${comment.participantPseudonym}`;
      discussionBody.focus();
    });
    article.append(reply);
    discussionThread.append(article);
  });
}

function discussionCategoryLabel(category) {
  return {
    agreement: "اتفاق معلّل",
    disagreement: "اختلاف معلّل",
    question: "سؤال علمي",
    clarification: "طلب توضيح",
    evidence: "دليل أو شاهد",
    "final-result": "تعليق على نتيجة نهائية",
    "consensus-proposal": "مقترح إجماع",
    escalation: "طلب تصعيد",
    appeal: "اعتراض موثق",
    recusal: "تنحٍّ لتعارض المصالح"
  }[category] || category;
}

async function submitDiscussionComment() {
  submitDiscussionButton.disabled = true;
  setDiscussionStatus("", false);
  try {
    if (!state.discussion.sourceReceiptId) {
      throw new Error("افتح نتائج مهمة مكتملة أولًا.");
    }
    const result = await apiJson("/api/discussion/comments", {
      method: "POST",
      body: {
        sourceReceiptId: state.discussion.sourceReceiptId,
        targetReceiptId: discussionTarget.value || null,
        parentCommentId: state.discussion.replyTo,
        category: discussionCategory.value,
        body: discussionBody.value,
        sentenceId: discussionSentence.value || null,
        tokenId: discussionToken.value || null,
        mentionedReceiptIds: selectedValues(discussionMentions),
        referencedReceiptIds: selectedValues(discussionReferences)
      }
    });
    discussionBody.value = "";
    discussionSentence.value = "";
    discussionToken.value = "";
    discussionMentions.selectedIndex = -1;
    discussionReferences.selectedIndex = -1;
    clearDiscussionReply();
    setDiscussionStatus(
      "نُشرت المداخلة بهوية مستعارة، وهي في انتظار فحص GitHub.",
      false
    );
    await loadDiscussion(state.discussion.sourceReceiptId);
    const comment = document.querySelector(
      `#comment-${result.comment.commentId}`
    );
    comment?.scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    setDiscussionStatus(error.message, true);
  } finally {
    submitDiscussionButton.disabled = false;
  }
}

function selectedValues(select) {
  return [...select.selectedOptions].map(option => option.value);
}

function clearDiscussionReply() {
  state.discussion.replyTo = null;
  replyContext.hidden = true;
  replyContextText.textContent = "";
}

function setDiscussionStatus(message, isError) {
  discussionStatus.textContent = message || "";
  discussionStatus.className = `status${message
    ? isError ? " error" : " success"
    : ""}`;
}

async function configureTurnstile() {
  if (!state.config.turnstileSiteKey) return;
  await loadScript(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
  );
}

async function ensureTurnstileWidget() {
  if (!state.config.turnstileSiteKey
      || state.turnstileWidgetId !== null) {
    return;
  }
  if (!window.turnstile) await configureTurnstile();
  state.turnstileWidgetId = turnstile.render("#turnstile-slot", {
    sitekey: state.config.turnstileSiteKey,
    language: "ar",
    theme: "light"
  });
}

function getTurnstileToken() {
  if (state.turnstileWidgetId === null || !window.turnstile) return "";
  return turnstile.getResponse(state.turnstileWidgetId);
}

function resetTurnstile() {
  if (state.turnstileWidgetId !== null && window.turnstile) {
    turnstile.reset(state.turnstileWidgetId);
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("تعذر تحميل اختبار الحماية.")),
      { once: true });
    document.head.append(script);
  });
}

function updateCompletion() {
  if (selectedRole() === "ratification") {
    const receipt = controlValue(workspace, ".primary-receipt");
    const decision = controlValue(workspace, ".ratification-decision");
    const rationale = controlValue(workspace, ".ratification-rationale");
    const completed = [
      /^[0-9a-f-]{36}$/i.test(receipt),
      Boolean(decision),
      rationale.trim().length >= 20
    ].filter(Boolean).length;
    completionValue.textContent = `${Math.round(completed / 3 * 100)}%`;
    return;
  }
  const controls = [...workspace.querySelectorAll(
    "select.structural, select.predicate, select.upos, select.relation, "
    + "select.irab-category, .head, .irab-head"
  )].filter(control => !control.disabled);
  const completed = controls.filter(control => control.value !== "").length;
  const percentage = controls.length === 0
    ? 0
    : Math.round(completed / controls.length * 100);
  completionValue.textContent = `${percentage}%`;
}

function sentenceShell(sentence) {
  const section = document.createElement("article");
  section.className = "sentence";
  section.dataset.sentenceId = sentence.sentenceId;
  const title = document.createElement("h4");
  title.textContent = `الجملة ${sentence.sentenceId}`;
  const text = document.createElement("div");
  text.className = "sentence-text";
  text.textContent = sentence.text;
  section.append(title, text);
  return section;
}

function tokenForm(token) {
  const element = document.createElement("div");
  element.className = "token-form";
  element.textContent = `${token.id}. ${token.form}`;
  return element;
}

function tokenSelectField(labelText, className, options, selected = "") {
  return labelled(
    labelText,
    selectControl(className, options, selected),
    "token-field",
    FIELD_HELP[className]
  );
}

function tokenReferenceField(
  labelText,
  className,
  sentenceTokens,
  currentTokenId,
  allowRoot,
  selected = ""
) {
  const control = referenceSelectControl(
    className,
    sentenceTokens,
    currentTokenId,
    allowRoot,
    selected
  );
  return labelled(
    labelText,
    control,
    "token-field",
    FIELD_HELP[className]
  );
}

function irabFields(
  sentenceTokens,
  currentTokenId,
  category = "",
  head = ""
) {
  const wrapper = document.createElement("div");
  wrapper.className = "irab-fields";
  const categoryControl = selectControl(
    "irab-category",
    IRAB,
    category ?? "");
  const headControl = referenceSelectControl(
    "irab-head",
    sentenceTokens,
    currentTokenId,
    false,
    head ?? ""
  );
  const categoryField = labelled(
    "فئة الإعراب",
    categoryControl,
    "token-field",
    FIELD_HELP.irabCategory
  );
  const headField = labelled(
    "رأس علاقة الإعراب",
    headControl,
    "token-field",
    FIELD_HELP.irabHead
  );
  wrapper.append(categoryField, headField);
  syncIrabHead(categoryControl);
  return wrapper;
}

function referenceSelectControl(
  className,
  sentenceTokens,
  currentTokenId,
  allowRoot,
  selected
) {
  const control = document.createElement("select");
  control.className = className;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = allowRoot
    ? "اختر كلمة، أو جذر الجملة…"
    : "اختر الكلمة المرتبط بها الدور…";
  control.append(blank);
  if (allowRoot) {
    const root = document.createElement("option");
    root.value = "0";
    root.textContent = "0 — جذر الجملة (لا يتبع كلمة)";
    root.selected = String(selected) === "0";
    control.append(root);
  }
  sentenceTokens
    .filter(token => Number(token.id) !== Number(currentTokenId))
    .forEach(token => {
      const option = document.createElement("option");
      option.value = String(token.id);
      option.textContent = `${token.id} — ${token.form}`;
      option.selected = String(token.id) === String(selected);
      control.append(option);
    });
  return control;
}

function syncIrabHead(categoryControl) {
  const head = categoryControl
    .closest(".irab-fields")
    ?.querySelector(".irab-head");
  if (!head) return;
  head.disabled = categoryControl.value === "_";
  if (head.disabled) head.value = "";
}

function textField(labelText, className) {
  const input = document.createElement("input");
  input.className = className;
  input.type = "text";
  input.maxLength = 500;
  return labelled(labelText, input, className);
}

function booleanSelect(className, selected = null) {
  return selectControl(
    className,
    [["true", "نعم"], ["false", "لا"]],
    selected === null ? "" : String(selected)
  );
}

function selectControl(className, options, selected = "") {
  const control = document.createElement("select");
  control.className = className;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "اختر…";
  control.append(blank);
  options.forEach(([value, label]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${label} (${value})`;
    option.selected = String(value) === String(selected);
    control.append(option);
  });
  return control;
}

function labelled(text, control, className = "", helpText = "") {
  const label = document.createElement("label");
  if (className) label.className = className;
  const span = document.createElement("span");
  span.textContent = text;
  label.append(span);
  if (helpText) {
    const help = document.createElement("small");
    help.className = "field-help";
    help.textContent = helpText;
    label.append(help);
  }
  label.append(control);
  return label;
}

function tokenSummary(token) {
  const irab = token.irabNotApplicable
    ? "غير منطبق"
    : `${token.irabCategory} @ ${token.irabHeadTokenId}`;
  return [
    `النوع: ${token.universalPartOfSpeech}`,
    `الرأس: ${token.headTokenId}`,
    `العلاقة: ${token.dependencyRelation}`,
    `الإعراب: ${irab}`
  ].join("\n");
}

function selectedRole() {
  return document.querySelector('input[name="role"]:checked')?.value ?? "A";
}

function operationalTestMode() {
  return (OPERATIONAL_TEST_REQUESTED
      || state.currentTaskLane === "operational-test")
    && state.packet?.pilotOnly === true
    && ["A", "B"].includes(selectedRole());
}

function roleLabel(role) {
  if (role === "operational-test") return "اختبار تشغيلي مُساعَد";
  if (role === "A") return "المعلّق المستقل A";
  if (role === "B") return "المعلّق المستقل B";
  if (role === "ratification") return "المراجع المستقل J2";
  return "المحكّم الأول J1";
}

function requiredBoolean(control) {
  if (!control || control.value === "") {
    throw new Error("أكمل قراري سلامة التركيب والإسناد لكل جملة.");
  }
  return control.value === "true";
}

function requiredControl(root, selector, label) {
  const result = root.querySelector(selector)?.value ?? "";
  requireText(result, label);
  return result;
}

function integerControl(root, selector, label) {
  const raw = root.querySelector(selector)?.value ?? "";
  if (raw === "") throw new Error(`${label} مطلوب.`);
  const result = Number(raw);
  if (!Number.isInteger(result) || result < 0) {
    throw new Error(`${label} يجب أن يكون عددًا صحيحًا غير سالب.`);
  }
  return result;
}

function requireText(text, label) {
  if (!text || !text.trim()) throw new Error(`${label} مطلوب.`);
}

function value(id) {
  return document.getElementById(id)?.value.trim() ?? "";
}

function checked(id) {
  return Boolean(document.getElementById(id)?.checked);
}

function nullable(text) {
  return text && text.trim() ? text.trim() : null;
}

function yesNo(value) {
  return value ? "نعم" : "لا";
}

function sentenceMap(sentences) {
  return new Map(sentences.map(sentence => [sentence.sentenceId, sentence]));
}

function tokenMap(tokens) {
  return new Map(tokens.map(token => [token.tokenId, token]));
}

async function readJson(file, label) {
  if (!file) throw new Error(`اختر ${label}.`);
  try {
    return JSON.parse(await file.text());
  } catch {
    throw new Error(`${label} ليس ملف JSON صالحًا.`);
  }
}

function downloadJson(fileName, valueToWrite) {
  const blob = new Blob(
    [JSON.stringify(valueToWrite, null, 2) + "\n"],
    { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function showStatus(message, isError) {
  const target = state.step === 5 ? submissionStatus : wizardStatus;
  target.textContent = message;
  target.className = `status ${isError ? "error" : "success"}${
    target === wizardStatus ? " wizard-status" : ""
  }`;
}

function showPendingStatus(message) {
  const target = state.step === 5 ? submissionStatus : wizardStatus;
  target.textContent = message;
  target.className = `status pending${
    target === wizardStatus ? " wizard-status" : ""
  }`;
}

function clearStatus() {
  submissionStatus.textContent = "";
  submissionStatus.className = "status";
  wizardStatus.textContent = "";
  wizardStatus.className = "status wizard-status";
}

function escapeHtml(valueToEscape) {
  const element = document.createElement("span");
  element.textContent = String(valueToEscape);
  return element.innerHTML;
}
