import StudioEditor from '../../../components/StudioEditor';

// Next 16: this route reads params at request time; opt out of instant-navigation prerender validation.
export const instant = false;

export default async function StudioProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <StudioEditor projectId={projectId} />;
}
