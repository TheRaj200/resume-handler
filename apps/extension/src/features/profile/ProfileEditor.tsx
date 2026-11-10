import { useState } from "react";
import { PersonalSection } from "./PersonalSection";
import { ProfessionalSection } from "./ProfessionalSection";
import { ExperienceSection } from "./ExperienceSection";
import { EducationSection } from "./EducationSection";
import { SkillsSection } from "./SkillsSection";
import { ProjectsSection } from "./ProjectsSection";
import { CustomFieldsSection } from "./CustomFieldsSection";
import { useProfileCompleteness } from "./useProfileCompleteness";

const SECTIONS = [
  { id: "personal", label: "Personal" },
  { id: "professional", label: "Professional" },
  { id: "experience", label: "Experience" },
  { id: "education", label: "Education" },
  { id: "skills", label: "Skills" },
  { id: "projects", label: "Projects" },
  { id: "custom", label: "Custom" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

export function ProfileEditor() {
  const [active, setActive] = useState<SectionId>("personal");
  const completeness = useProfileCompleteness();

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Master Profile</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Autofill aur resume generation isi data se hoga.
            </p>
          </div>
          <span className="text-xs font-semibold text-brand-300">{completeness}%</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-brand-500/150/150 transition-all"
            style={{ width: `${completeness}%` }}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {SECTIONS.map((section) => (
          <button
            key={section.id}
            onClick={() => setActive(section.id)}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
              active === section.id
                ? "bg-brand-500/150/15 text-brand-200"
                : "text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
            }`}
          >
            {section.label}
          </button>
        ))}
      </div>

      {active === "personal" ? <PersonalSection /> : null}
      {active === "professional" ? <ProfessionalSection /> : null}
      {active === "experience" ? <ExperienceSection /> : null}
      {active === "education" ? <EducationSection /> : null}
      {active === "skills" ? <SkillsSection /> : null}
      {active === "projects" ? <ProjectsSection /> : null}
      {active === "custom" ? <CustomFieldsSection /> : null}
    </div>
  );
}
