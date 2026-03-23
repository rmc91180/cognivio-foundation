import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  GripVertical,
  Trash2,
  Save,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTemplateStore } from '@/store/templateStore';
import type { Element, AggregationMode } from '@/types';

interface ColumnConfig {
  id: string;
  name: string;
  weight: number;
  enabled: boolean;
  elementIds: string[];
}

export const ElementSelection: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('templateId');

  const { domains, fetchElements, createTemplate, isLoading } = useTemplateStore();

  const [templateName, setTemplateName] = useState('Custom Template');
  const [aggregationMode, setAggregationMode] = useState<AggregationMode>('weighted');
  const [columns, setColumns] = useState<ColumnConfig[]>([
    { id: '1', name: 'Planning', weight: 1, enabled: true, elementIds: [] },
    { id: '2', name: 'Environment', weight: 1, enabled: true, elementIds: [] },
    { id: '3', name: 'Instruction', weight: 1, enabled: true, elementIds: [] },
    { id: '4', name: 'Professional', weight: 1, enabled: true, elementIds: [] },
  ]);
  const [expandedDomains, setExpandedDomains] = useState<string[]>([]);
  const [selectedElement, setSelectedElement] = useState<Element | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggedElement, setDraggedElement] = useState<Element | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [focusedElementIndex, setFocusedElementIndex] = useState<number>(-1);
  const elementListRef = useRef<HTMLDivElement>(null);

  // Flatten all elements for keyboard navigation
  const allElements = domains.flatMap((d) => d.elements);

  useEffect(() => {
    if (templateId) {
      fetchElements(templateId);
    }
  }, [templateId, fetchElements]);

  // Keyboard event handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Save shortcut
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
        return;
      }

      // If element is selected, handle column assignment
      if (selectedElement) {
        const enabledColumns = columns.filter((c) => c.enabled);

        // Number keys 1-4 to assign to columns
        if (e.key >= '1' && e.key <= '4') {
          const colIndex = parseInt(e.key) - 1;
          if (colIndex < enabledColumns.length) {
            assignToColumn(enabledColumns[colIndex].id);
          }
          return;
        }

        // Escape to deselect
        if (e.key === 'Escape') {
          setSelectedElement(null);
          return;
        }

        // Delete to remove from column
        if (e.key === 'Delete' || e.key === 'Backspace') {
          const col = columns.find((c) => c.elementIds.includes(selectedElement.id));
          if (col) {
            removeFromColumn(col.id, selectedElement.id);
          }
          return;
        }
      }

      // Arrow key navigation in element list
      if (focusedElementIndex >= 0 || e.key === 'ArrowDown') {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedElementIndex((prev) =>
            Math.min(prev + 1, allElements.length - 1)
          );
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedElementIndex((prev) => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && focusedElementIndex >= 0) {
          e.preventDefault();
          handleElementClick(allElements[focusedElementIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedElement, columns, focusedElementIndex, allElements]);

  // Drag-drop handlers
  const handleDragStart = (e: React.DragEvent, element: Element) => {
    setDraggedElement(element);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', element.id);
  };

  const handleDragEnd = () => {
    setDraggedElement(null);
    setDragOverColumn(null);
  };

  const handleDragOver = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(columnId);
  };

  const handleDragLeave = () => {
    setDragOverColumn(null);
  };

  const handleDrop = (e: React.DragEvent, columnId: string) => {
    e.preventDefault();
    if (draggedElement) {
      // Remove from any existing column and add to new one
      setColumns((prev) =>
        prev.map((col) => {
          const filtered = col.elementIds.filter((id) => id !== draggedElement.id);
          if (col.id === columnId) {
            return { ...col, elementIds: [...filtered, draggedElement.id] };
          }
          return { ...col, elementIds: filtered };
        })
      );
    }
    setDraggedElement(null);
    setDragOverColumn(null);
  };

  const toggleDomain = (domainId: string) => {
    setExpandedDomains((prev) =>
      prev.includes(domainId)
        ? prev.filter((id) => id !== domainId)
        : [...prev, domainId]
    );
  };

  const isElementAssigned = (elementId: string) => {
    return columns.some((col) => col.elementIds.includes(elementId));
  };

  const getElementColumn = (elementId: string) => {
    const col = columns.find((c) => c.elementIds.includes(elementId));
    return col?.name;
  };

  const handleElementClick = (element: Element) => {
    setSelectedElement(selectedElement?.id === element.id ? null : element);
  };

  const assignToColumn = (columnId: string) => {
    if (!selectedElement) return;

    setColumns((prev) =>
      prev.map((col) => {
        // Remove from any existing column
        const filtered = col.elementIds.filter((id) => id !== selectedElement.id);
        // Add to target column
        if (col.id === columnId) {
          return { ...col, elementIds: [...filtered, selectedElement.id] };
        }
        return { ...col, elementIds: filtered };
      })
    );
    setSelectedElement(null);
  };

  const removeFromColumn = (columnId: string, elementId: string) => {
    setColumns((prev) =>
      prev.map((col) =>
        col.id === columnId
          ? { ...col, elementIds: col.elementIds.filter((id) => id !== elementId) }
          : col
      )
    );
  };

  const updateColumn = (columnId: string, updates: Partial<ColumnConfig>) => {
    setColumns((prev) =>
      prev.map((col) => (col.id === columnId ? { ...col, ...updates } : col))
    );
  };

  const handleSave = async () => {
    // Validate
    const enabledColumns = columns.filter((c) => c.enabled);
    const emptyColumns = enabledColumns.filter((c) => c.elementIds.length === 0);

    if (emptyColumns.length > 0) {
      setError(`Assign at least one element to: ${emptyColumns.map((c) => c.name).join(', ')}`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const newTemplateId = await createTemplate({
        name: templateName,
        description: 'Custom template created via element selection',
        aggregationMode,
        columns: columns
          .filter((c) => c.enabled)
          .map((c) => ({
            name: c.name,
            weight: c.weight,
            enabled: c.enabled,
            elementIds: c.elementIds,
          })),
      });

      navigate(`/roster?templateId=${newTemplateId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const getElementById = (elementId: string): Element | undefined => {
    for (const domain of domains) {
      const element = domain.elements.find((e) => e.id === elementId);
      if (element) return element;
    }
    return undefined;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Go back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="font-heading text-2xl font-bold text-gray-900">
              Customize Evaluation Columns
            </h1>
            <p className="text-gray-600 mt-1">
              Drag elements to columns or select and assign using keyboard
            </p>
          </div>
        </div>

        <Button onClick={handleSave} isLoading={saving} leftIcon={<Save className="w-4 h-4" />}>
          Save Template
        </Button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      )}

      {/* Template Name and Aggregation */}
      <Card className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px]">
          <Input
            label="Template Name"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Enter template name"
          />
        </div>
        <div className="w-48">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Score Calculation
          </label>
          <select
            value={aggregationMode}
            onChange={(e) => setAggregationMode(e.target.value as AggregationMode)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="weighted">Weighted Average</option>
            <option value="worst">Worst Score</option>
            <option value="majority">Majority Color</option>
          </select>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Panel - Domain List */}
        <div className="lg:col-span-1">
          <Card className="sticky top-20">
            <h2 className="font-heading font-semibold text-lg text-gray-900 mb-4">
              Available Elements
            </h2>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              </div>
            ) : (
              <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                {domains.map((domain) => (
                  <div key={domain.id} className="border border-gray-200 rounded-lg">
                    <button
                      onClick={() => toggleDomain(domain.id)}
                      className="w-full flex items-center justify-between p-3 hover:bg-gray-50 text-left"
                    >
                      <span className="font-medium text-gray-900 text-sm">
                        {domain.name}
                      </span>
                      {expandedDomains.includes(domain.id) ? (
                        <ChevronDown className="w-4 h-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-500" />
                      )}
                    </button>

                    {expandedDomains.includes(domain.id) && (
                      <div className="border-t border-gray-100 p-2 space-y-1" ref={elementListRef}>
                        {domain.elements.map((element) => {
                          const assigned = isElementAssigned(element.id);
                          const column = getElementColumn(element.id);
                          const globalIndex = allElements.findIndex((e) => e.id === element.id);

                          return (
                            <div
                              key={element.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, element)}
                              onDragEnd={handleDragEnd}
                              onClick={() => handleElementClick(element)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  handleElementClick(element);
                                }
                              }}
                              tabIndex={0}
                              role="button"
                              aria-pressed={selectedElement?.id === element.id}
                              className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm transition-colors cursor-grab active:cursor-grabbing ${
                                selectedElement?.id === element.id
                                  ? 'bg-primary-100 border-primary-500 border'
                                  : draggedElement?.id === element.id
                                  ? 'bg-blue-100 border-blue-300 border opacity-50'
                                  : focusedElementIndex === globalIndex
                                  ? 'ring-2 ring-primary-500 bg-gray-50'
                                  : assigned
                                  ? 'bg-gray-100 text-gray-500'
                                  : 'hover:bg-gray-50'
                              }`}
                            >
                              <GripVertical className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              <span className="flex-1 truncate">{element.name}</span>
                              {assigned && (
                                <span className="text-xs bg-gray-200 px-2 py-0.5 rounded">
                                  {column}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {selectedElement && (
              <div className="mt-4 p-3 bg-primary-50 rounded-lg border border-primary-200">
                <p className="text-sm font-medium text-primary-900 mb-2">
                  Selected: {selectedElement.name}
                </p>
                <p className="text-xs text-primary-700 mb-3">
                  Press 1-4 to assign to a column, or click a column below
                </p>
                <div className="flex flex-wrap gap-2">
                  {columns.filter((c) => c.enabled).map((col, idx) => (
                    <button
                      key={col.id}
                      onClick={() => assignToColumn(col.id)}
                      className="px-3 py-1 text-xs bg-white border border-primary-300 rounded hover:bg-primary-100"
                    >
                      {idx + 1}: {col.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Center - Metric Columns */}
        <div className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-4">
            {columns.map((column) => (
              <Card
                key={column.id}
                className={`${!column.enabled && 'opacity-50'}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <input
                    type="text"
                    value={column.name}
                    onChange={(e) => updateColumn(column.id, { name: e.target.value })}
                    className="font-heading font-semibold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-300 focus:border-primary-500 focus:outline-none"
                  />
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={column.enabled}
                      onChange={(e) => updateColumn(column.id, { enabled: e.target.checked })}
                      className="w-4 h-4 text-primary-600 rounded"
                    />
                    <span className="text-xs text-gray-500">Enabled</span>
                  </label>
                </div>

                <div className="mb-4">
                  <label className="text-xs text-gray-500">Weight: {column.weight}</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={column.weight}
                    onChange={(e) =>
                      updateColumn(column.id, { weight: parseFloat(e.target.value) })
                    }
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                  />
                </div>

                <div
                  className={`min-h-[200px] border-2 border-dashed rounded-lg p-3 transition-all ${
                    dragOverColumn === column.id
                      ? 'border-blue-500 bg-blue-50 scale-[1.02]'
                      : selectedElement
                      ? 'border-primary-300 bg-primary-50'
                      : 'border-gray-200'
                  }`}
                  onClick={() => selectedElement && assignToColumn(column.id)}
                  onDragOver={(e) => handleDragOver(e, column.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, column.id)}
                >
                  {column.elementIds.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-8">
                      {dragOverColumn === column.id
                        ? 'Drop here to add'
                        : selectedElement
                        ? 'Click to add element'
                        : 'Drag elements here'}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {column.elementIds.map((elemId) => {
                        const element = getElementById(elemId);
                        if (!element) return null;

                        return (
                          <div
                            key={elemId}
                            draggable
                            onDragStart={(e) => handleDragStart(e, element)}
                            onDragEnd={handleDragEnd}
                            className="flex items-center justify-between bg-white p-2 rounded border border-gray-200 cursor-grab active:cursor-grabbing hover:border-gray-300"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <GripVertical className="w-3 h-3 text-gray-400 flex-shrink-0" />
                              <span className="text-sm text-gray-700 truncate">
                                {element.name}
                              </span>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromColumn(column.id, elemId);
                              }}
                              className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0"
                              aria-label="Remove element"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <p className="text-xs text-gray-500 mt-2">
                  {column.elementIds.length} element{column.elementIds.length !== 1 && 's'}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </div>

      {/* Keyboard Shortcuts Help */}
      <div className="text-center text-sm text-gray-500">
        <strong>Keyboard shortcuts:</strong> 1-4: Assign to column • Delete: Remove •
        Ctrl+S: Save
      </div>
    </div>
  );
};

export default ElementSelection;
