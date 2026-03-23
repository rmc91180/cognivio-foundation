import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search,
  Filter,
  Download,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ColorChip } from '@/components/ui/ColorChip';
import { rosterApi, rubricsApi } from '@/services/api';
import type { RosterRow, RosterTotals, RubricTemplate, StatusColor } from '@/types';
import { formatDistanceToNow } from 'date-fns';

export const RosterPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows] = useState<RosterRow[]>([]);
  const [totals, setTotals] = useState<RosterTotals | null>(null);
  const [templates, setTemplates] = useState<RubricTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const templateId = searchParams.get('templateId') || '';
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || [];
  const [sortField, setSortField] = useState<string>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [showFilters, setShowFilters] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const loadTemplates = async () => {
      try {
        const data = await rubricsApi.getTemplates();
        setTemplates(data);
        // Set default template if none selected
        if (!templateId && data.length > 0) {
          setSearchParams({ templateId: data[0].id });
        }
      } catch (err) {
        console.error('Failed to load templates:', err);
      }
    };
    loadTemplates();
  }, []);

  useEffect(() => {
    const loadRoster = async () => {
      if (!templateId) return;

      setLoading(true);
      setError(null);

      try {
        const data = await rosterApi.getRoster({
          templateId,
          page,
          pageSize,
          sort: sortField,
          order: sortOrder,
          search: search || undefined,
          status: statusFilter.length > 0 ? statusFilter : undefined,
        });

        setRows(data.rows);
        setTotals(data.totals);
        setTotalPages(data.meta?.totalPages || 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load roster');
      } finally {
        setLoading(false);
      }
    };

    loadRoster();
  }, [templateId, page, sortField, sortOrder, search, statusFilter.join(',')]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set('search', value);
    } else {
      params.delete('search');
    }
    setSearchParams(params);
    setPage(1);
  };

  const toggleStatusFilter = (status: StatusColor) => {
    const params = new URLSearchParams(searchParams);
    const current = params.get('status')?.split(',').filter(Boolean) || [];
    const updated = current.includes(status)
      ? current.filter((s) => s !== status)
      : [...current, status];

    if (updated.length > 0) {
      params.set('status', updated.join(','));
    } else {
      params.delete('status');
    }
    setSearchParams(params);
    setPage(1);
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? (
      <ChevronUp className="w-4 h-4" />
    ) : (
      <ChevronDown className="w-4 h-4" />
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900">Teacher Roster</h1>
          <p className="text-gray-600 mt-1">
            Using: {templates.find((t) => t.id === templateId)?.name || 'Select a template'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={templateId}
            onChange={(e) => {
              const params = new URLSearchParams(searchParams);
              params.set('templateId', e.target.value);
              setSearchParams(params);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <Button variant="secondary" leftIcon={<Download className="w-4 h-4" />}>
            Export
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <Card padding="sm" className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="search"
            placeholder="Search teachers..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Filter className="w-4 h-4" />}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
            {statusFilter.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 bg-primary-100 text-primary-700 text-xs rounded">
                {statusFilter.length}
              </span>
            )}
          </Button>

          {statusFilter.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const params = new URLSearchParams(searchParams);
                params.delete('status');
                setSearchParams(params);
              }}
            >
              <X className="w-4 h-4" />
              Clear
            </Button>
          )}
        </div>

        {showFilters && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <span className="text-sm text-gray-500">Status:</span>
            {(['green', 'yellow', 'red'] as StatusColor[]).map((status) => (
              <button
                key={status}
                onClick={() => toggleStatusFilter(status)}
                className={`px-3 py-1 text-sm rounded-full border transition-colors ${
                  statusFilter.includes(status)
                    ? status === 'green'
                      ? 'bg-green-100 border-green-500 text-green-700'
                      : status === 'yellow'
                      ? 'bg-yellow-100 border-yellow-500 text-yellow-700'
                      : 'bg-red-100 border-red-500 text-red-700'
                    : 'bg-gray-100 border-gray-300 text-gray-600'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Summary Cards */}
      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Card padding="sm" className="text-center">
            <p className="text-2xl font-bold text-gray-900">{totals.total}</p>
            <p className="text-sm text-gray-500">Total Teachers</p>
          </Card>
          <Card padding="sm" className="text-center bg-green-50 border-green-200">
            <p className="text-2xl font-bold text-green-700">{totals.green}</p>
            <p className="text-sm text-green-600">On Track</p>
          </Card>
          <Card padding="sm" className="text-center bg-yellow-50 border-yellow-200">
            <p className="text-2xl font-bold text-yellow-700">{totals.yellow}</p>
            <p className="text-sm text-yellow-600">Needs Attention</p>
          </Card>
          <Card padding="sm" className="text-center bg-red-50 border-red-200">
            <p className="text-2xl font-bold text-red-700">{totals.red}</p>
            <p className="text-sm text-red-600">Critical</p>
          </Card>
          <Card padding="sm" className="text-center">
            <p className="text-2xl font-bold text-gray-900">{totals.missingGradebook}</p>
            <p className="text-sm text-gray-500">Missing Grades</p>
          </Card>
        </div>
      )}

      {/* Roster Table */}
      <Card padding="none">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : error ? (
          <div className="text-center py-12">
            <AlertTriangle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-red-600">{error}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No teachers match your filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th
                    className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                    onClick={() => handleSort('name')}
                  >
                    <div className="flex items-center gap-1">
                      Teacher Name
                      <SortIcon field="name" />
                    </div>
                  </th>
                  {rows[0]?.metrics.map((metric) => (
                    <th
                      key={metric.columnId}
                      className="px-4 py-3 text-center text-sm font-medium text-gray-600"
                    >
                      {metric.columnName}
                    </th>
                  ))}
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                    Gradebook
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => (
                  <tr
                    key={row.teacherId}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() =>
                      navigate(
                        `/teachers/${row.teacherId}?templateId=${templateId}`
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium text-gray-900">{row.teacherName}</p>
                        <p className="text-sm text-gray-500">
                          {row.subjects.join(', ')}
                        </p>
                      </div>
                    </td>
                    {row.metrics.map((metric) => (
                      <td key={metric.columnId} className="px-4 py-3 text-center">
                        <div className="flex justify-center">
                          <ColorChip
                            color={metric.color}
                            showTooltip
                            tooltipContent={`Score: ${metric.numericScore}% • ${
                              metric.lastObserved
                                ? `Last: ${formatDistanceToNow(
                                    new Date(metric.lastObserved),
                                    { addSuffix: true }
                                  )}`
                                : 'No observations'
                            }`}
                          />
                        </div>
                      </td>
                    ))}
                    <td className="px-4 py-3 text-center">
                      {row.gradebookStatus.missingGrades ? (
                        <span className="inline-flex items-center gap-1 text-yellow-600">
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-xs">Missing</span>
                        </span>
                      ) : (
                        <span className="text-green-600 text-sm">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RosterPage;
