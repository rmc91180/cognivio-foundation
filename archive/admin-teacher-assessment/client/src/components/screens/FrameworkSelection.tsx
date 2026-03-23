import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Eye, FileText, Layers, Sparkles, ArrowLeft } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useTemplateStore } from '@/store/templateStore';
import type { RubricTemplate, Domain } from '@/types';
import { rubricsApi } from '@/services/api';

export const FrameworkSelection: React.FC = () => {
  const navigate = useNavigate();
  const { templates, fetchTemplates, selectTemplate, isLoading } = useTemplateStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [setAsDefault, setSetAsDefault] = useState(true);
  const [previewTemplate, setPreviewTemplate] = useState<RubricTemplate | null>(null);
  const [previewDomains, setPreviewDomains] = useState<Domain[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handlePreview = async (template: RubricTemplate) => {
    setPreviewTemplate(template);
    setPreviewLoading(true);
    try {
      const data = await rubricsApi.getElements(template.id);
      setPreviewDomains(data.domains);
    } catch (error) {
      console.error('Failed to load preview:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSelect = async () => {
    if (!selectedId) return;
    await selectTemplate(selectedId, setAsDefault);
    navigate(`/frameworks/elements?templateId=${selectedId}`);
  };

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'danielson':
        return <FileText className="w-8 h-8" />;
      case 'marshall':
        return <Layers className="w-8 h-8" />;
      case 'custom':
        return <Sparkles className="w-8 h-8" />;
      default:
        return <FileText className="w-8 h-8" />;
    }
  };

  const getSourceColor = (source: string) => {
    switch (source) {
      case 'danielson':
        return 'bg-blue-100 text-blue-600';
      case 'marshall':
        return 'bg-purple-100 text-purple-600';
      case 'custom':
        return 'bg-amber-100 text-amber-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
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
            Select Evaluation Framework
          </h1>
          <p className="text-gray-600 mt-1">
            Choose a rubric framework to evaluate teacher performance
          </p>
        </div>
      </div>

      {/* Framework Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((template) => (
          <Card
            key={template.id}
            className={`relative cursor-pointer transition-all ${
              selectedId === template.id
                ? 'ring-2 ring-primary-500 shadow-md'
                : 'hover:shadow-md'
            }`}
            onClick={() => setSelectedId(template.id)}
          >
            {selectedId === template.id && (
              <div className="absolute top-3 right-3 w-6 h-6 bg-primary-600 rounded-full flex items-center justify-center">
                <Check className="w-4 h-4 text-white" />
              </div>
            )}

            <div className={`p-3 rounded-lg w-fit ${getSourceColor(template.source)}`}>
              {getSourceIcon(template.source)}
            </div>

            <h3 className="font-heading font-semibold text-lg text-gray-900 mt-4">
              {template.name}
            </h3>

            <p className="text-sm text-gray-600 mt-2 line-clamp-2">
              {template.description || 'No description available'}
            </p>

            <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
              <span>{template.domainsCount} Domains</span>
              <span>•</span>
              <span>{template.elementsCount} Elements</span>
            </div>

            <div className="flex items-center gap-2 mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(template);
                }}
              >
                <Eye className="w-4 h-4 mr-1" />
                Preview
              </Button>
            </div>
          </Card>
        ))}
      </div>

      {/* Default Toggle and Select Button */}
      <div className="flex items-center justify-between bg-white rounded-lg border border-gray-200 p-4">
        <label className="flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={setAsDefault}
            onChange={(e) => setSetAsDefault(e.target.checked)}
            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
          />
          <span className="ml-2 text-sm text-gray-700">Set as my default framework</span>
        </label>

        <Button
          onClick={handleSelect}
          disabled={!selectedId || isLoading}
          isLoading={isLoading}
        >
          Select Framework
        </Button>
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h2 className="font-heading text-xl font-bold text-gray-900">
                  {previewTemplate.name}
                </h2>
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="p-2 hover:bg-gray-100 rounded-lg"
                  aria-label="Close preview"
                >
                  ✕
                </button>
              </div>
              <p className="text-gray-600 mt-1">{previewTemplate.description}</p>
            </div>

            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {previewLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
                </div>
              ) : (
                <div className="space-y-4">
                  {previewDomains.map((domain) => (
                    <div key={domain.id} className="border border-gray-200 rounded-lg">
                      <div className="p-4 bg-gray-50 border-b border-gray-200">
                        <h3 className="font-medium text-gray-900">{domain.name}</h3>
                        {domain.description && (
                          <p className="text-sm text-gray-600 mt-1">{domain.description}</p>
                        )}
                      </div>
                      <div className="p-4">
                        <ul className="space-y-2">
                          {domain.elements.map((element) => (
                            <li key={element.id} className="text-sm text-gray-700">
                              • {element.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  setSelectedId(previewTemplate.id);
                  setPreviewTemplate(null);
                }}
              >
                Select This Framework
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FrameworkSelection;
