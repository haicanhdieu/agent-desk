import { useQuery, useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import {
  PageSearch,
  loadPage,
  pageOfSearch,
  pageToSearch,
  readPageSize,
  useClampToLastPage,
  usePageSize,
  usePagedQuery,
  usePaginationProps,
} from '@/app/pagination';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { requireProjectPermission } from '@/features/access/guards';
import { projectPaths, useDeskFrame } from '@/features/desk/frame';
import { rulesUsing, skillFileHref, toSkill } from '@/features/desk/map';
import { isStaleSkill, useCommitSkill, useDeleteSkill } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { useSkillFolders } from '@/features/desk/skillFolders';
import { projectsQueries } from '@/features/projects/queries';
import { DeskSkills, type SkillSubmission } from '@/screens';

const SkillsSearch = z.object({ ...PageSearch.shape, skill: z.string().optional().catch(undefined) });

/** The skill to open: the one in the URL when the repo has it (on the page or anywhere), else the page's first. */
const openSkill = (pageNames: string[], allNames: string[] | undefined, wanted: string | undefined) =>
  wanted !== undefined && (pageNames.includes(wanted) || allNames?.includes(wanted)) ? wanted : pageNames[0];

export const Route = createFileRoute('/o/$org/p/$project/desk/skills')({
  staticData: { chrome: { mode: 'standard', scope: 'project', item: 'skills', crumb: 'Skills', fill: true } },
  validateSearch: (search) => SkillsSearch.parse(search),
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search), skill: search.skill }),
  // Desk config is for roles that hold `skill:read` on this project; the guard runs before any loader.
  beforeLoad: ({ context: { queryClient }, params }) =>
    requireProjectPermission(queryClient, params.org, 'skill:read', params.project),
  loader: async ({ context: { queryClient }, params: { org, project }, deps, cause }) => {
    const pageOptions = deskQueries.skills(org, project, { page: deps.page, pageSize: readPageSize() });
    await Promise.all([
      loadPage(queryClient, pageOptions, cause),
      queryClient.ensureQueryData(deskQueries.allRules(org, project)),
    ]);
    // Between pages the page is only prefetched, so the open skill is looked up in the whole set (cached after the
    // first read): the editor keeps it, with no flash of the new page's first skill.
    const pageNames = queryClient.getQueryData(pageOptions.queryKey)?.items.map((s) => s.name) ?? [];
    const offPage = deps.skill !== undefined && !pageNames.includes(deps.skill);
    const all = offPage ? await queryClient.ensureQueryData(deskQueries.allSkills(org, project)) : undefined;
    const name = openSkill(
      pageNames,
      all?.items.map((s) => s.name),
      deps.skill,
    );
    if (name !== undefined) await queryClient.ensureQueryData(deskQueries.skill(org, project, name));
  },
  component: DeskSkillsPage,
});

function DeskSkillsPage() {
  const { org, project: projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const toast = useToast();
  const now = useNow();
  const frame = useDeskFrame(org, projectId, now);
  const folders = useSkillFolders(org, projectId);
  const current = pageOfSearch(search);
  const [pageSize] = usePageSize();
  const { data: skillsPage, busy } = usePagedQuery({ page: current, pageSize }, (q) =>
    deskQueries.skills(org, projectId, q),
  );
  const list = skillsPage.items;
  const { data: rulesPage } = useSuspenseQuery(deskQueries.allRules(org, projectId));
  const rules = rulesPage.items;
  // A skill linked from another page is looked up in the whole set (read only when the link needs it).
  const listNames = list.map((s) => s.name);
  const { data: wholeSet } = useQuery({
    ...deskQueries.allSkills(org, projectId),
    enabled: search.skill !== undefined && !listNames.includes(search.skill),
  });
  const activeName = openSkill(
    listNames,
    wholeSet?.items.map((s) => s.name),
    search.skill,
  );
  // The open skill's body and sha; none when the repo has no skills.
  const detailQueries: ReturnType<typeof deskQueries.skill>[] =
    activeName === undefined ? [] : [deskQueries.skill(org, projectId, activeName)];
  const detail = useSuspenseQueries({ queries: detailQueries })[0]?.data;
  const commit = useCommitSkill(org, projectId);
  const remove = useDeleteSkill(org, projectId);
  const [deleting, setDeleting] = useState<string>();
  // The last change request opened for review: pending, not merged, so it never replaces the skill shown.
  const [submission, setSubmission] = useState<SkillSubmission>();
  const { data: projectDto } = useSuspenseQuery(projectsQueries.detail(org, projectId));

  // No silent overwrite: a draft is bound to the sha it started from, and a commit always sends that sha. A
  // background refetch that brings a newer sha keeps the draft and its base, so committing it gets a 409 instead of
  // overwriting. A 409 keeps the draft and base. A successful commit or a Discard bumps `generation`, which starts a
  // new draft from the fresh body and sha.
  const [generation, setGeneration] = useState(0);
  const editorKey = `${activeName ?? ''}:${generation}`;
  const [base, setBase] = useState<{ key: string; sha: string }>();
  if (detail && base?.key !== editorKey) setBase({ key: editorKey, sha: detail.sha });
  const restartDraft = () => setGeneration((g) => g + 1);
  // `isPending` only shows after a render; this blocks a second click that lands before it.
  const committing = useRef(false);

  // The open skill may be off the current page: its detail, not the page's list, is the source of its file path.
  const activeDetail = detail ? toSkill(detail, rules, now) : undefined;
  const skills = list.map((s) => toSkill(s.name === activeName && detail ? detail : s, rules, now));
  const historyHref = activeDetail ? skillFileHref(projectDto.skillFileBaseUrl, activeDetail.path) : undefined;
  const paths = projectPaths(org, projectId);
  const skillHref = (name: string) => {
    const page = pageToSearch(current);
    return `${paths.skills}?skill=${encodeURIComponent(name)}${page === undefined ? '' : `&page=${page}`}`;
  };
  // A page change keeps the open skill in the editor: it goes into the URL, as the page's first skill would replace it.
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p), skill: activeName }), replace });
  useClampToLastPage(current, skillsPage.pageSize, skillsPage.total, (p) => go(p, true));
  const pagination = usePaginationProps({
    page: skillsPage.page,
    pageSize: skillsPage.pageSize,
    total: skillsPage.total,
    busy,
    go,
  });

  const onCommit = (body: string, message: string) => {
    if (!detail || activeName === undefined || committing.current) return;
    committing.current = true;
    // A new attempt replaces the last notice, so a failure never leaves a stale "submitted" banner.
    setSubmission(undefined);
    const sha = base?.key === editorKey ? base.sha : detail.sha;
    commit.mutate(
      { name: activeName, body, message: message.trim() || `Update ${activeName} skill`, sha },
      {
        // The hook has refetched the skill by now; the next draft starts from the fresh body and sha.
        onSettled: () => {
          committing.current = false;
        },
        onSuccess: (res) => {
          if (res.kind === 'commit') {
            setSubmission(undefined);
            toast.show({ tone: 'ok', title: `Skill saved to ${res.targetBranch}` });
            restartDraft();
            return;
          }
          // Pending review: the editor keeps the draft and the skill on the target branch is unchanged.
          setSubmission({ action: 'save', ...res });
        },
        // A stale 409 keeps the draft and its base sha (the hook toasts and refetches), so a resubmit 409s again.
        onError: (e) => {
          if (!isStaleSkill(e)) toast.show(toastFromError(e));
        },
      },
    );
  };

  const onConfirmDelete = (message: string) => {
    if (deleting === undefined) return;
    const name = deleting;
    remove.mutate(
      { name, message },
      {
        onSuccess: (res) => {
          setDeleting(undefined);
          if (res.kind !== 'commit') {
            // Pending review: the skill is still live, so it stays listed and open.
            setSubmission({ action: 'delete', ...res });
            return;
          }
          setSubmission(undefined);
          toast.show({ tone: 'ok', title: `Skill ${name} removed from ${res.targetBranch}` });
          if (search.skill === name)
            void navigate({ search: (prev) => ({ ...prev, skill: undefined }), replace: true });
        },
        onError: (e) => toast.show(toastFromError(e)),
      },
    );
  };

  return (
    <DeskSkills
      height="viewport"
      frame={frame}
      skills={skills}
      activeName={activeName}
      active={activeDetail}
      pagination={pagination}
      editorKey={editorKey}
      folders={folders}
      defaultBranch={projectDto.defaultBranch}
      historyHref={historyHref ?? undefined}
      committing={commit.isPending}
      deletePending={remove.isPending}
      submission={submission}
      onDismissSubmission={() => setSubmission(undefined)}
      skillHref={skillHref}
      onSelect={(name) => {
        setSubmission(undefined);
        void navigate({ search: (prev) => ({ ...prev, skill: name }) });
      }}
      onCommit={onCommit}
      onDiscard={restartDraft}
      onDelete={setDeleting}
      deleting={deleting}
      rulesUsing={deleting === undefined ? [] : rulesUsing(deleting, rules)}
      onCloseDelete={() => setDeleting(undefined)}
      onConfirmDelete={onConfirmDelete}
    />
  );
}
