import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileText, Library, Search } from 'lucide-react';
import { api, errMsg } from '@/lib/api';
import { formatFileSize, openResourceDownload } from '@/lib/resources';
import { PageHeader, ListSkeleton, LoadErrorState, EmptyState } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export default function ClientResources() {
  const [resources, setResources] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [downloadingId, setDownloadingId] = useState('');

  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/resources');
      setResources(data || []);
      setLoadError(null);
    } catch (error) {
      const message = errMsg(error, 'Failed to load resources');
      setLoadError(message);
      toast.error(message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(() => {
    const byId = new Map();
    for (const resource of resources || []) {
      if (resource.category?.id) byId.set(resource.category.id, resource.category);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [resources]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (resources || []).filter((resource) => (
      (categoryId === 'all' || resource.category_id === categoryId)
      && (!query || resource.title.toLowerCase().includes(query))
    ));
  }, [resources, search, categoryId]);

  const download = async (resource) => {
    setDownloadingId(resource.id);
    try {
      await openResourceDownload(resource.id);
    } catch (error) {
      toast.error(errMsg(error, 'Could not download resource'));
    } finally {
      setDownloadingId('');
    }
  };

  if (!resources && loadError) return <LoadErrorState message={loadError} scope="client-resources" onRetry={() => { setLoadError(null); load(); }} />;
  if (!resources) return <ListSkeleton rows={3} />;

  return (
    <div>
      <PageHeader title="Resources" subtitle="PDF handouts shared by your coach" />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search resources..." className="h-11 rounded-xl pl-9" data-testid="client-resource-search" />
        </div>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="h-11 rounded-xl" data-testid="client-resource-category-filter"><SelectValue placeholder="All categories" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categories.map((category) => <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Library} title="No resources available" subtitle={search || categoryId !== 'all' ? 'Try a different search or category.' : 'Your coach will share PDF handouts here.'} testId="client-resources-empty" />
      ) : (
        <div className="space-y-3">
          {filtered.map((resource) => (
            <Card key={resource.id} data-testid="client-resource-card">
              <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary"><FileText className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-display font-semibold" data-testid="client-resource-title">{resource.title}</p>
                      {resource.is_public && <Badge variant="outline" className="border-success/25 bg-success/10 text-success-foreground">Public</Badge>}
                    </div>
                    {resource.description && <p className="mt-1 text-sm text-muted-foreground">{resource.description}</p>}
                    <p className="mt-1 text-xs text-muted-foreground">
                      {resource.category?.name || 'Uncategorized'}
                      {formatFileSize(resource.file_size_bytes) ? ` · ${formatFileSize(resource.file_size_bytes)}` : ''}
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" className="rounded-xl" disabled={downloadingId === resource.id} onClick={() => download(resource)} data-testid="client-resource-download">
                  <Download className="mr-1.5 h-4 w-4" /> Download PDF
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
