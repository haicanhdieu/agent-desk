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
import { projectPaths, useDeskFrame } from '@/features/desk/frame';
import { rulesUsing, toSkill } from '@/features/desk/map';
import { isStaleSkill, useCommitSkill, useDeleteSkill } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { DeskSkills } from '@/screens';

const SkillsSearch = z.object({ ...PageSearch.shape, skill: z.string().optional().catch(undefined) });

/** The skill to open: the one in the URL when the repo has it (on the page or anywhere), else the page's first. */
const openSkill = (pageNames: string[], allNames: string[] | undefined, wanted: string | undefined) =>
  wanted !== undefined && (pageNames.includes(wanted) || allNames?.includes(wanted)) ? wanted : pageNames[0];

export const Route = createFileRoute('/o/$org/p/$project/desk/skills')({
  validateSearch: (search) => SkillsSearch.parse(search),
  loaderDeps: ({ search }) => ({ page: pageOfSearch(search), skill: search.skill }),
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

  // No silent overwrite: a draft is bound to the sha it started from, and a commit always sends that sha. A
  // background refetch that brings a newer sha keeps the draft and its base, so committing it gets a 409 instead of
  // overwriting. A 409 or a successful commit bumps `generation`, which starts a new draft from the fresh body.
  const [generation, setGeneration] = useState(0);
  const editorKey = `${activeName ?? ''}:${generation}`;
  const [base, setBase] = useState<{ key: string; sha: string }>();
  if (detail && base?.key !== editorKey) setBase({ key: editorKey, sha: detail.sha });
  const restartDraft = () => setGeneration((g) => g + 1);
  // `isPending` only shows after a render; this blocks a second click that lands before it.
  const committing = useRef(false);

  const skills = list.map((s) => toSkill(s.name === activeName && detail ? detail : s, rules, now));
  const paths = projectPaths(org, projectId);
  const skillHref = (name: string) => {
    const page = pageToSearch(current);
    return `${paths.skills}?skill=${encodeURIComponent(name)}${page === undefined ? '' : `&page=${page}`}`;
  };
  // A page change keeps the open skill in the editor: it goes into the URL, as the page's first skill would replace it.
  const go = (p: number, replace = false) =>
    void navigate({ search: (prev) => ({ ...prev, page: pageToSearch(p), skill: activeName }), replace });
  useClampToLastPage(current, skillsPage.pageSize, skillsPage.total, (p) => go(p, true));
  const pagination = usePaginationProps({ page: current, total: skillsPage.total, busy, go });

  const onCommit = (body: string, message: string) => {
    if (!detail || activeName === undefined || committing.current) return;
    committing.current = true;
    const sha = base?.key === editorKey ? base.sha : detail.sha;
    commit.mutate(
      { name: activeName, body, message: message.trim() || `Update ${activeName} skill`, sha },
      {
        // The hook has refetched the skill by now; the next draft starts from the fresh body and sha.
        onSettled: () => {
          committing.current = false;
        },
        onSuccess: restartDraft,
        onError: (e) => (isStaleSkill(e) ? restartDraft() : toast.show(toastFromError(e))),
      },
    );
  };

  const onConfirmDelete = (message: string) => {
    if (deleting === undefined) return;
    const name = deleting;
    remove.mutate(
      { name, message },
      {
        onSuccess: () => {
          setDeleting(undefined);
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
      active={detail ? toSkill(detail, rules, now) : undefined}
      pagination={pagination}
      editorKey={editorKey}
      committing={commit.isPending}
      skillHref={skillHref}
      onSelect={(name) => void navigate({ search: (prev) => ({ ...prev, skill: name }) })}
      onCommit={onCommit}
      onDelete={setDeleting}
      deleting={deleting}
      rulesUsing={deleting === undefined ? [] : rulesUsing(deleting, rules)}
      onCloseDelete={() => setDeleting(undefined)}
      onConfirmDelete={onConfirmDelete}
    />
  );
}
