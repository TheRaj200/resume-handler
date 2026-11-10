import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationInput,
  type ApplicationStatus,
} from "@jobpilot/shared";
import {
  db,
  deleteApplication,
  exportApplicationsCsv,
  exportApplicationsXlsx,
  linkResumeVersionToApplication,
  saveApplication,
  updateApplicationStatus,
} from "../../db";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  inputClass,
  type BadgeTone,
} from "../../components/ui";

function statusTone(status: ApplicationStatus): BadgeTone {
  switch (status) {
    case "OFFER":
      return "emerald";
    case "REJECTED":
      return "rose";
    case "INTERVIEW":
    case "SCREENING":
      return "amber";
    case "APPLIED":
      return "indigo";
    default:
      return "slate";
  }
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString();
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function ApplicationsManager() {
  const applications = useLiveQuery(
    () => db.applications.orderBy("updatedAt").reverse().toArray(),
    [],
  );

  const [search, setSearch] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("ALL");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Status update modal state
  const [statusModalApp, setStatusModalApp] = useState<Application | null>(null);
  const [targetStatus, setTargetStatus] = useState<ApplicationStatus>("APPLIED");
  const [statusNote, setStatusNote] = useState("");
  const [linkModalApp, setLinkModalApp] = useState<Application | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState("");

  // New Application modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newCompany, setNewCompany] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newStatus, setNewStatus] = useState<ApplicationStatus>("DRAFT");
  const [newNotes, setNewNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const activeApplications = useMemo(() => {
    return (applications ?? []).filter((app) => !app.deletedAt);
  }, [applications]);
  const resumeVersions = useLiveQuery(
    () => db.resumeVersions.orderBy("createdAt").reverse().toArray(),
    [],
  );

  const filteredApplications = useMemo(() => {
    return activeApplications.filter((app) => {
      if (selectedStatus !== "ALL" && app.status !== selectedStatus) return false;
      if (search.trim()) {
        const query = search.trim().toLowerCase();
        const matchesCompany = app.company.toLowerCase().includes(query);
        const matchesTitle = app.jobTitle.toLowerCase().includes(query);
        const matchesNotes = app.notes?.toLowerCase().includes(query);
        if (!matchesCompany && !matchesTitle && !matchesNotes) return false;
      }
      return true;
    });
  }, [activeApplications, selectedStatus, search]);

  const stats = useMemo(() => {
    const total = activeApplications.length;
    const applied = activeApplications.filter((a) => a.status === "APPLIED").length;
    const interviews = activeApplications.filter(
      (a) => a.status === "INTERVIEW" || a.status === "SCREENING",
    ).length;
    const offers = activeApplications.filter((a) => a.status === "OFFER").length;
    return { total, applied, interviews, offers };
  }, [activeApplications]);

  async function handleExportCsv() {
    try {
      const csv = await exportApplicationsCsv();
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `JobPilot_Applications_${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Export failed");
    }
  }

  async function handleExportXlsx() {
    try {
      const bytes = await exportApplicationsXlsx();
      const blob = new Blob([bytes as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `JobPilot_Applications_${new Date().toISOString().slice(0, 10)}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Excel export failed");
    }
  }

  async function handleCreateApplication(event: React.FormEvent) {
    event.preventDefault();
    if (!newCompany.trim() || !newTitle.trim()) {
      setError("Company and Job Title are required.");
      return;
    }
    setError(null);
    try {
      const input: ApplicationInput = {
        company: newCompany.trim(),
        jobTitle: newTitle.trim(),
        jobUrl: newUrl.trim() || undefined,
        status: newStatus,
        notes: newNotes.trim() || undefined,
      };
      await saveApplication(input);
      setShowAddModal(false);
      setNewCompany("");
      setNewTitle("");
      setNewUrl("");
      setNewNotes("");
      setNewStatus("DRAFT");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to create application");
    }
  }

  function openStatusModal(app: Application, next: ApplicationStatus) {
    setStatusModalApp(app);
    setTargetStatus(next);
    setStatusNote("");
  }

  async function handleConfirmStatusUpdate() {
    if (!statusModalApp) return;
    try {
      await updateApplicationStatus(
        statusModalApp.id,
        targetStatus,
        statusNote.trim() || undefined,
      );
      setStatusModalApp(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update status");
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Are you sure you want to delete this application?")) return;
    try {
      await deleteApplication(id, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to delete");
    }
  }

  function openLinkModal(app: Application) {
    setLinkModalApp(app);
    setSelectedVersionId(app.resumeVersionId ?? resumeVersions?.[0]?.id ?? "");
  }

  async function handleLinkResume() {
    if (!linkModalApp || !selectedVersionId) return;
    try {
      await linkResumeVersionToApplication(linkModalApp.id, selectedVersionId);
      setLinkModalApp(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link resume version");
    }
  }

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid grid-cols-4 gap-2">
        <Card className="p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-0.5 text-base font-bold text-slate-800">{stats.total}</p>
        </Card>
        <Card className="p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-indigo-400">Applied</p>
          <p className="mt-0.5 text-base font-bold text-indigo-600">{stats.applied}</p>
        </Card>
        <Card className="p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-amber-400">Interviews</p>
          <p className="mt-0.5 text-base font-bold text-amber-300">{stats.interviews}</p>
        </Card>
        <Card className="p-2.5 text-center">
          <p className="text-[10px] uppercase tracking-wide text-emerald-400">Offers</p>
          <p className="mt-0.5 text-base font-bold text-emerald-600">{stats.offers}</p>
        </Card>
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-between gap-2">
        <Button
          variant="primary"
          className="text-xs py-1.5 px-3"
          onClick={() => setShowAddModal(true)}
        >
          + Add Application
        </Button>
        <Button
          variant="secondary"
          className="text-xs py-1.5 px-3"
          onClick={handleExportCsv}
          disabled={activeApplications.length === 0}
        >
          Export CSV
        </Button>
        <Button
          variant="secondary"
          className="text-xs py-1.5 px-3"
          onClick={() => void handleExportXlsx()}
          disabled={activeApplications.length === 0}
        >
          Export XLSX
        </Button>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {error}
        </div>
      ) : null}

      {/* Search and Status Filters */}
      <div className="space-y-2">
        <input
          type="text"
          className={inputClass}
          placeholder="Search by company, role or notes..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setSelectedStatus("ALL")}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
              selectedStatus === "ALL"
                ? "bg-brand-500/25 text-indigo-700"
                : "text-slate-400 hover:bg-slate-50"
            }`}
          >
            All ({activeApplications.length})
          </button>
          {APPLICATION_STATUSES.map((status) => {
            const count = activeApplications.filter((a) => a.status === status).length;
            if (count === 0 && selectedStatus !== status) return null;
            return (
              <button
                key={status}
                onClick={() => setSelectedStatus(status)}
                className={`shrink-0 rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${
                  selectedStatus === status
                    ? "bg-brand-500/25 text-indigo-700"
                    : "text-slate-400 hover:bg-slate-50"
                }`}
              >
                {STATUS_LABELS[status]} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Applications List */}
      {filteredApplications.length === 0 ? (
        <EmptyState
          title="No applications found"
          description={
            search || selectedStatus !== "ALL"
              ? "No applications match your search or filter."
              : "Form autofill hone ke baad draft banega, ya '+ Add Application' se manually log karo."
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {filteredApplications.map((app) => {
            const isExpanded = expandedId === app.id;
            return (
              <li key={app.id}>
                <Card className="p-3.5 space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-slate-800">
                          {app.company}
                        </p>
                        {app.jobUrl ? (
                          <a
                            href={app.jobUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] text-indigo-400 hover:text-indigo-600 underline"
                          >
                            Job Link
                          </a>
                        ) : null}
                      </div>
                      <p className="truncate text-xs text-slate-500">{app.jobTitle}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {app.appliedAt
                          ? `Applied: ${formatDate(app.appliedAt)}`
                          : `Updated: ${formatDate(app.updatedAt)}`}
                      </p>
                    </div>

                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <Badge tone={statusTone(app.status)}>
                        {STATUS_LABELS[app.status]}
                      </Badge>

                      {/* Status Transition Shortcut */}
                      <select
                        aria-label="Change status"
                        className="rounded border border-slate-200 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-500 outline-none"
                        value={app.status}
                        onChange={(event) =>
                          openStatusModal(app, event.target.value as ApplicationStatus)
                        }
                      >
                        {APPLICATION_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {app.notes ? (
                    <p className="text-xs text-slate-400 italic bg-slate-50 p-1.5 rounded-lg border border-white/5">
                      "{app.notes}"
                    </p>
                  ) : null}

                  {/* Expand/Collapse details */}
                  <div className="flex items-center justify-between border-t border-white/5 pt-2 text-[11px]">
                    <button
                      className="text-indigo-400 hover:text-indigo-600"
                      onClick={() => setExpandedId(isExpanded ? null : app.id)}
                    >
                      {isExpanded ? "Hide Details" : "View Details & History"}
                    </button>
                    <button
                      className="text-rose-400 hover:text-rose-600"
                      onClick={() => handleDelete(app.id)}
                    >
                      Delete
                    </button>
                  </div>

                  {/* Expanded detail section */}
                   {isExpanded ? (
                    <div className="space-y-3 pt-2 text-xs border-t border-slate-200">
                       {app.resumeVersionId ? (
                        <div>
                          <span className="text-slate-500 font-medium">Resume Version: </span>
                          <span className="text-slate-500 font-mono text-[11px]">
                            {app.resumeVersionId}
                          </span>
                        </div>
                       ) : null}

                       <div className="flex items-center justify-between gap-2">
                         <span className="text-slate-500 font-medium">Resume:</span>
                         <Button
                           variant="secondary"
                           className="px-2 py-1 text-[10px]"
                           onClick={() => openLinkModal(app)}
                           disabled={!resumeVersions?.length}
                         >
                           {app.resumeVersionId ? "Change linked version" : "Link resume version"}
                         </Button>
                       </div>

                       {app.resumeVersionId ? (() => {
                         const linked = resumeVersions?.find(
                           (version) => version.id === app.resumeVersionId,
                         );
                         return linked ? (
                           <div className="rounded-lg border border-emerald-400/15 bg-emerald-500/5 p-2 text-[11px] text-slate-500">
                             <span className="text-emerald-600">Linked:</span> v{linked.versionNumber} · {linked.content.targetRole} · {formatDate(linked.createdAt)}
                           </div>
                         ) : null;
                       })() : null}

                      {app.jdSnapshot ? (
                        <div>
                          <p className="text-slate-500 font-medium mb-1">JD Snapshot:</p>
                          <div className="max-h-28 overflow-y-auto rounded bg-white p-2 text-[10px] text-slate-400 whitespace-pre-wrap">
                            {app.jdSnapshot}
                          </div>
                        </div>
                      ) : null}

                      {/* Timeline Events */}
                      <div>
                        <p className="text-slate-400 font-medium mb-1.5">Timeline History:</p>
                        <div className="space-y-1.5 border-l-2 border-indigo-500/30 pl-2.5">
                          {app.events && app.events.length > 0 ? (
                            app.events.map((ev, index) => (
                              <div key={index} className="text-[11px]">
                                <div className="flex items-center gap-1.5">
                                  <Badge tone={statusTone(ev.status)}>
                                    {STATUS_LABELS[ev.status]}
                                  </Badge>
                                  <span className="text-[10px] text-slate-500">
                                    {formatDateTime(ev.at)}
                                  </span>
                                </div>
                                {ev.note ? (
                                  <p className="text-slate-400 mt-0.5">{ev.note}</p>
                                ) : null}
                              </div>
                            ))
                          ) : (
                            <p className="text-[10px] text-slate-500">No events recorded.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {/* Add Application Modal */}
      {showAddModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-900 p-4 shadow-2xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Add Job Application</h3>
            <form onSubmit={handleCreateApplication} className="space-y-2.5">
              <Field label="Company *">
                <input
                  type="text"
                  required
                  className={inputClass}
                  placeholder="e.g. Google, Microsoft, Startup"
                  value={newCompany}
                  onChange={(event) => setNewCompany(event.target.value)}
                />
              </Field>

              <Field label="Job Title *">
                <input
                  type="text"
                  required
                  className={inputClass}
                  placeholder="e.g. Full Stack Developer"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
              </Field>

              <Field label="Job URL">
                <input
                  type="url"
                  className={inputClass}
                  placeholder="https://..."
                  value={newUrl}
                  onChange={(event) => setNewUrl(event.target.value)}
                />
              </Field>

              <Field label="Initial Status">
                <select
                  className={inputClass}
                  value={newStatus}
                  onChange={(event) =>
                    setNewStatus(event.target.value as ApplicationStatus)
                  }
                >
                  {APPLICATION_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABELS[status]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Notes">
                <textarea
                  className={inputClass}
                  rows={2}
                  placeholder="Optional notes..."
                  value={newNotes}
                  onChange={(event) => setNewNotes(event.target.value)}
                />
              </Field>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary">
                  Save
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Status Update Note Modal */}
      {statusModalApp ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-slate-900 p-4 shadow-2xl space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">
              Update Status: {statusModalApp.company}
            </h3>
            <p className="text-xs text-slate-400">
              Changing from <span className="font-semibold text-slate-700">{STATUS_LABELS[statusModalApp.status]}</span> to{" "}
              <span className="font-semibold text-indigo-600">{STATUS_LABELS[targetStatus]}</span>.
            </p>

            <Field label="Timeline Note (Optional)">
              <textarea
                className={inputClass}
                rows={2}
                placeholder="e.g. Received email for technical interview, completed task..."
                value={statusNote}
                onChange={(event) => setStatusNote(event.target.value)}
              />
            </Field>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStatusModalApp(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleConfirmStatusUpdate}
              >
                Confirm Update
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {linkModalApp ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm space-y-3 rounded-2xl border border-slate-200 bg-slate-900 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-800">Link generated resume</h3>
            <p className="text-xs text-slate-400">
              {linkModalApp.company} · {linkModalApp.jobTitle}
            </p>
            <Field label="Resume version">
              <select
                className={inputClass}
                value={selectedVersionId}
                onChange={(event) => setSelectedVersionId(event.target.value)}
              >
                <option value="">Select a version…</option>
                {(resumeVersions ?? []).map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.versionNumber} · {version.content.targetRole} · {formatDate(version.createdAt)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setLinkModalApp(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => void handleLinkResume()}
                disabled={!selectedVersionId}
              >
                Link resume
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
