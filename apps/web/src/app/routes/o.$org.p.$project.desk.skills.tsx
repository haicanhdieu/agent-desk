import { useSuspenseQueries, useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { toastFromError } from '@/app/boundaries';
import { useNow } from '@/app/useNow';
import { useToast } from '@/ds';
import { projectPaths, useDeskFrame } from '@/features/desk/frame';
import { rulesUsing, toSkill } from '@/features/desk/map';
import { isStaleSkill, useCommitSkill, useDeleteSkill } from '@/features/desk/mutations';
import { deskQueries } from '@/features/desk/queries';
import { DeskSkills } from '@/screens';

const SkillsSearch = z.object({ skill: z.string().optional().catch(undefined) });

/** The skill to open: the one in the URL when the repo has it, else the first. */
const openSkill = (names: string[], wanted: string | undefined) =>
  wanted !== undefined && names.includes(wanted) ? wanted : names[0];

export const Route = createFileRoute('/o/$org/p/$project/desk/skills')({
  validateSearch: (search) => SkillsSearch.parse(search),
  loaderDeps: ({ search }) => ({ skill: search.skill }),
  loader: async ({ context: { queryClient }, params: { org, project }, deps }) => {
    const [skills] = await Promise.all([
      queryClient.ensureQueryData(deskQueries.skills(org, project)),
      queryClient.ensureQueryData(deskQueries.rules(org, project)),
    ]);
    const name = openSkill(
      skills.map((s) => s.name),
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
  const { data: list } = useSuspenseQuery(deskQueries.skills(org, projectId));
  const { data: rules } = useSuspenseQuery(deskQueries.rules(org, projectId));
  const activeName = openSkill(
    list.map((s) => s.name),
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
  const skillHref = (name: string) => `${paths.skills}?skill=${encodeURIComponent(name)}`;

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
          if (search.skill === name) void navigate({ search: {}, replace: true });
        },
        onError: (e) => toast.show(toastFromError(e)),
      },
    );
  };

  return (
    <DeskSkills
      frame={frame}
      skills={skills}
      activeName={activeName}
      editorKey={editorKey}
      committing={commit.isPending}
      skillHref={skillHref}
      onSelect={(name) => void navigate({ search: { skill: name } })}
      onCommit={onCommit}
      onDelete={setDeleting}
      deleting={deleting}
      rulesUsing={deleting === undefined ? [] : rulesUsing(deleting, rules)}
      onCloseDelete={() => setDeleting(undefined)}
      onConfirmDelete={onConfirmDelete}
    />
  );
}
