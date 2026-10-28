// Shared record forms, edit dialogs and cards. Workflow guards and persisted values stay unchanged.
export const recordsUiScript=String.raw`
const recordKinds = Object.freeze({ clients: "client", projects: "project", tasks: "task", notes: "document" });
function recordForm(record, container = main, state = view) {
  const { page, parents, staff } = state;
  if (actor.role !== "staff" || !["clients", "projects", "tasks", "notes"].includes(page)) return;
  const panel = node("section", undefined, "panel");
  panel.append(node("h2", (record ? "Edit " : "Add ") + recordKinds[page]));
  const form = document.createElement("form");
  if (page === "tasks" && !record) form.setAttribute("data-task-create", "");
  if (page === "notes" && !record) {
    form.setAttribute("data-document-create", "");
    for (const event of ["input", "change"]) form.addEventListener(event, () => {
      form.dataset.dirty = "true";
    });
  }
  field(form, ["clients", "projects"].includes(page) ? "name" : "title", "Name");
  if (page === "projects") field(form, "clientId", "Client", "text", parents);
  if (["tasks", "notes"].includes(page)) field(form, "projectId", "Project", "text", parents);
  if (page === "clients") {
    field(form, "email", "Contact email", "email").required = false;
    field(form, "company", "Company").required = false;
  }
  if (page === "projects") {
    field(form, "status", "Status", "text", Object.entries(projectStatusNames).map(([id, name]) => ({ id, name }))).value = "active";
    field(form, "archived", "Archive project", "checkbox");
  }
  if (page === "tasks") {
    field(form, "status", "Status", "text", Object.entries(taskStatusNames).map(([id, name]) => ({ id, name }))).value = "todo";
    field(form, "assigneeId", "Assigned to", "text", staff).required = false;
    field(form, "dueOn", "Due date", "date").required = false;
  }
  if (page === "notes") {
    const parent = field(form, "parentId", "Parent document", "text", []);
    parent.required = false;
    const selected = state.documentParents.find((n) => n.id === state.documentOptions.parentId);
    form.elements.projectId.value = record?.project_id || state.documentDraft?.projectId || selected?.project_id || state.documentOptions.projectId || "";
    documentParents(form, record, state, parent);
    parent.value = record ? record.parent_id || "" : state.documentDraft?.parentId ?? selected?.id ?? "";
    form.elements.projectId.onchange = () => documentParents(form, record, state, parent);
    field(form, "text", "Content", "textarea");
  }
  if (page !== "clients") field(form, "clientVisible", "Share with client", "checkbox");
  if (record) {
    for (const input of form.elements) {
      const column = { clientId: "client_id", projectId: "project_id", clientVisible: "client_visible", assigneeId: "assignee_id", dueOn: "due_on", parentId: "parent_id" }[input.name] || input.name;
      if (input.type === "checkbox") input.checked = Boolean(record[column]);
      else input.value = record[column] ?? "";
      if (["clientId", "projectId"].includes(input.name)) input.disabled = true;
    }
  }
  if (page === "tasks" && !record && state.taskDraft) {
    for (const input of form.elements) {
      if (input.type === "checkbox") input.checked = Boolean(state.taskDraft[input.name]);
      else if (input.name in state.taskDraft) input.value = state.taskDraft[input.name];
    }
  }
  if (page === "notes" && !record && state.documentDraft) {
    for (const input of form.elements) {
      if (input.type === "checkbox") input.checked = Boolean(state.documentDraft[input.name]);
      else if (input.name in state.documentDraft) input.value = state.documentDraft[input.name];
    }
  }
  const save = node("button", "Save");
  save.type = "submit";
  const actions = node("div", undefined, "form-actions");
  actions.append(save);
  form.append(actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!current(state)) return;
    save.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      if (page !== "clients") body.clientVisible = form.elements.clientVisible.checked;
      if (page === "projects") body.archived = form.elements.archived.checked;
      if (page === "tasks") {
        body.assigneeId = body.assigneeId || null;
        body.dueOn = body.dueOn || null;
      }
      if (page === "notes") body.parentId = body.parentId || null;
      if (record) body.revision = record.revision;
      await api(page + (record ? "/" + record.id : ""), record ? "PATCH" : "POST", body);
      if (record) container.close();
      else if (page === "tasks") {
        state.discardTaskDraft = true;
        state.taskDraft = null;
      } else if (page === "notes") {
        state.discardDocumentDraft = true;
        state.documentOptions = { q: "", projectId: body.projectId, parentId: body.parentId || "root", includeArchived: false };
      }
      await refresh(state, Boolean(record));
    } catch (err) {
      if (current(state)) error(err.message, form);
    } finally {
      save.disabled = false;
    }
  };
  panel.append(form);
  container.append(panel);
  return { form, actions };
}
function editRecord(record, opener, state) {
  const { page } = state;
  const dialog = node("dialog");
  dialog.setAttribute("aria-label", "Edit " + recordKinds[page]);
  const { actions } = recordForm(record, dialog, state);
  actions.append(button("Cancel", () => dialog.close(), true, state));
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (current(state) && opener?.isConnected) opener.focus();
  }, { once: true });
  main.append(dialog);
  dialog.showModal();
}
function fileForm(state) {
  const { parents } = state;
  if (actor.role !== "staff") return;
  const panel = node("section", undefined, "panel"), form = document.createElement("form");
  panel.append(node("h2", "Upload private file"));
  field(form, "projectId", "Project", "text", parents);
  field(form, "original", "File (maximum 5 MiB)", "file");
  field(form, "clientVisible", "Share with client", "checkbox");
  const save = node("button", "Upload file");
  save.type = "submit";
  const actions = node("div", undefined, "form-actions");
  actions.append(save);
  form.append(actions);
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!current(state)) return;
    save.disabled = true;
    try {
      const file = form.elements.original.files[0];
      if (!file || file.size < 1 || file.size > 5242880) throw Error("Choose a file between 1 byte and 5 MiB.");
      const r = await fetch("/api/files", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/octet-stream", "X-Project-Id": form.elements.projectId.value, "X-File-Name": encodeURIComponent(file.name), "X-Client-Visible": String(form.elements.clientVisible.checked) }, body: file });
      if (r.redirected || !r.headers.get("content-type")?.includes("application/json")) throw Error("Session ended. Sign in again.");
      const data = await r.json();
      if (!r.ok) throw Error(data.error || "Upload failed");
      await refresh(state, true);
    } catch (err) {
      if (current(state)) error(err.message, form);
    } finally {
      save.disabled = false;
    }
  };
  panel.append(form);
  main.append(panel);
}
function recordItem(record, state) {
  const { page } = state;
  const actions = node("div", undefined, "record-actions");
  const item = node("article", undefined, "item"), line = node("div", undefined, "row");
  line.append(node("strong", record.name || record.title || "Time entry"));
  if (record.status) line.append(node("span", recordStatusName(page, record.status), "badge"));
  if (record.client_visible !== undefined) line.append(node("span", record.client_visible ? "Shared with client" : "Internal", "badge"));
  item.append(line);
  if (record.text) item.append(node("p", record.text));
  if (record.email) item.append(node("p", record.email));
  if (record.due_on) item.append(node("p", "Due " + record.due_on));
  if (record.assignee_id) item.append(node("p", "Assigned to " + record.assignee_id));
  if (actor.role === "staff" && ["clients", "projects", "tasks", "notes"].includes(page)) {
    const edit = button("Edit " + (record.name || record.title), (opener) => editRecord(record, opener, state), true, state);
    edit.textContent = "Edit " + recordKinds[page];
    edit.setAttribute("aria-label", "Edit " + (record.name || record.title));
    actions.append(edit);
  }
  if (page === "projects") {
    if (record.archived) item.append(node("span", "Archived project", "badge"));
    if (actor.role === "staff") {
      if (!record.archived) actions.append(projectTimer(record, state));
      actions.append(button((record.archived ? "Restore project " : "Archive project ") + record.name, async () => {
        await api("projects/" + record.id, "PATCH", { archived: !record.archived, revision: record.revision });
        await refresh(state, true);
      }, true, state));
    }
  }
  if (page === "time") {
    item.dataset.recentTime = record.id;
    actions.append(button("Time entry details", (opener) => timeDetails(record.id, opener, state), true, state));
    item.append(node("p", record.ended_at ? Math.floor(record.seconds / 60) + " minutes" : "Running since " + new Date(record.started_at).toLocaleTimeString("en-CA")));
    if (!record.ended_at) {
      const stop = button("Stop timer", async () => {
        await changeTimer("timer/" + record.id + "/stop", {});
        await refresh(state);
      });
      stop.dataset.timeStop = record.id;
      actions.append(stop);
    }
  }
  if (page === "notes") {
    const ancestors = documentAncestors(record, state);
    item.append(node("p", "Location: " + (ancestors.length ? ancestors.map((n) => n.title).join(" / ") : "Root"), "help"));
    if (record.archived) item.append(node("span", "Archived", "badge"));
    else if (ancestors.some((n) => n.archived)) item.append(node("p", "Hidden by an archived ancestor.", "help"));
    if (ancestors.some((n) => !n.client_visible)) item.append(node("p", "An internal ancestor limits client access.", "help"));
    actions.append(button("Open children", () => {
      state.documentOptions = { ...state.documentOptions, q: "", projectId: record.project_id, parentId: record.id };
      return load(true);
    }, true, state));
    if (actor.role === "staff") {
      const archive = button(record.archived ? "Restore document" : "Archive document", async () => {
        await api("notes/" + record.id, "PATCH", { archived: !record.archived, revision: record.revision });
        await refresh(state, true);
      }, true, state);
      archive.setAttribute("aria-label", (record.archived ? "Restore document " : "Archive document ") + record.title);
      actions.append(archive);
    }
  }
  if (page === "notes" && actor.role === "staff") {
    const history = button("History", (opener) => documentVersions(record, opener, state), true, state);
    history.setAttribute("aria-label", "Version history for " + record.title);
    actions.append(history);
  }
  if (page === "tasks") {
    const discussion = button("Comments", (opener) => taskComments(record, opener, state), true, state);
    discussion.setAttribute("aria-label", "Comments for " + record.title);
    actions.append(discussion, recordLink("tasks", record.id, state.recordId === record.id ? "Task link" : "Open task details", (state.recordId === record.id ? "Task link for " : "Open task details for ") + record.title));
  }
  if (actor.role === "staff" && page === "tasks" && !["retired", "archived"].includes(record.status)) actions.append(button(record.status === "done" ? "Reopen task" : "Complete task", async () => {
    await api("tasks/" + record.id, "PATCH", { status: record.status === "done" ? "todo" : "done", revision: record.revision });
    await refresh(state);
  }, true));
  if (page === "files") {
    item.append(node("p", record.size + " bytes \xB7 " + (record.deleted ? "Removed" : "Available")));
    if (!record.deleted) {
      const link = node("a", "Download " + record.name, "button");
      link.href = "/api/files/" + record.id + "/download";
      actions.append(link);
    }
    if (actor.role === "staff") {
      actions.append(button(record.deleted ? "Restore " + record.name : "Remove " + record.name, async () => {
        await api("files/" + record.id, "PATCH", { deleted: !record.deleted, revision: record.revision });
        await refresh(state, true);
      }, true));
      if (!record.deleted) actions.append(button(record.client_visible ? "Make internal " + record.name : "Share " + record.name, async () => {
        await api("files/" + record.id, "PATCH", { clientVisible: !record.client_visible, revision: record.revision });
        await refresh(state, true);
      }, true));
    }
  }
  if (actions.childElementCount) item.append(actions);
  return item;
}
`;
