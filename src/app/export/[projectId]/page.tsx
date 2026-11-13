import ExportWorkspace from '../../../components/ExportWorkspace';

// Next 16: this route reads params at request time; opt out of instant-navigation prerender validation.
export const instant = false;

export default async function ExportPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ExportWorkspace projectId={projectId} />;
}
