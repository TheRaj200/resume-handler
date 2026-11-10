import { useLiveQuery } from "dexie-react-hooks";
import { db, getProfile } from "../../db";

/**
 * Rough profile completeness score used by the dashboard and editor header.
 * Keep the weights simple and transparent: nine equal checks.
 */
export function useProfileCompleteness(): number {
  const profile = useLiveQuery(() => getProfile(), []);
  const experiences = useLiveQuery(() => db.experiences.count(), [], 0);
  const educations = useLiveQuery(() => db.educations.count(), [], 0);
  const skills = useLiveQuery(() => db.skills.count(), [], 0);
  const projects = useLiveQuery(() => db.projects.count(), [], 0);
  const resumes = useLiveQuery(() => db.resumes.count(), [], 0);

  const checks = [
    Boolean(profile?.firstName && profile?.lastName),
    Boolean(profile?.email),
    Boolean(profile?.phone),
    Boolean(profile?.headline),
    experiences > 0,
    educations > 0,
    skills > 0,
    projects > 0,
    resumes > 0,
  ];

  const completed = checks.filter(Boolean).length;
  return Math.round((completed / checks.length) * 100);
}
