import React, { useEffect, useState } from 'react';
import {
  Settings,
  Save,
  AlertTriangle,
  Check,
  Palette,
  Sliders,
  BarChart3,
  Info,
  RefreshCw,
} from 'lucide-react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { settingsApi } from '@/services/api';
import type { AggregationMode } from '@/types';

interface ThresholdSettings {
  greenMin: number;
  yellowMin: number;
  aggregationMode: AggregationMode;
}

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<ThresholdSettings>({
    greenMin: 80,
    yellowMin: 60,
    aggregationMode: 'weighted',
  });
  const [originalSettings, setOriginalSettings] = useState<ThresholdSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await settingsApi.getThresholds();
        if (data) {
          const loadedSettings = {
            greenMin: data.greenMin || 80,
            yellowMin: data.yellowMin || 60,
            aggregationMode: (data as any).aggregationMode || 'weighted',
          };
          setSettings(loadedSettings);
          setOriginalSettings(loadedSettings);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings');
      } finally {
        setLoading(false);
      }
    };

    fetchSettings();
  }, []);

  const hasChanges = originalSettings
    ? JSON.stringify(settings) !== JSON.stringify(originalSettings)
    : false;

  const handleSave = async () => {
    // Validate
    if (settings.greenMin <= settings.yellowMin) {
      setError('Green threshold must be higher than yellow threshold');
      return;
    }

    if (settings.yellowMin < 0 || settings.greenMin > 100) {
      setError('Thresholds must be between 0 and 100');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      await settingsApi.updateThresholds(settings.greenMin, settings.yellowMin);
      setOriginalSettings(settings);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalSettings) {
      setSettings(originalSettings);
    }
    setError(null);
  };

  const handleRestoreDefaults = () => {
    setSettings({
      greenMin: 80,
      yellowMin: 60,
      aggregationMode: 'weighted',
    });
  };

  const getColorPreview = (score: number) => {
    if (score >= settings.greenMin) return 'bg-green-500';
    if (score >= settings.yellowMin) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Settings className="w-6 h-6" />
            Settings
          </h1>
          <p className="text-gray-600 mt-1">
            Configure color thresholds and scoring behavior for your assessment platform
          </p>
        </div>
      </div>

      {/* Success Message */}
      {success && (
        <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <Check className="w-5 h-5" />
          Settings saved successfully!
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <AlertTriangle className="w-5 h-5" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Threshold Settings */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardTitle>
              <Palette className="w-5 h-5 text-primary-600 mr-2" />
              Color Thresholds
            </CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Set the score boundaries for green, yellow, and red performance indicators.
            </p>

            <div className="mt-6 space-y-6">
              {/* Green Threshold */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    Green Threshold (On Track)
                  </label>
                  <span className="text-sm text-gray-500">{settings.greenMin}% and above</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.greenMin}
                  onChange={(e) =>
                    setSettings({ ...settings, greenMin: Number(e.target.value) })
                  }
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-500"
                />
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={settings.greenMin}
                    onChange={(e) =>
                      setSettings({ ...settings, greenMin: Number(e.target.value) })
                    }
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>

              {/* Yellow Threshold */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    Yellow Threshold (Needs Attention)
                  </label>
                  <span className="text-sm text-gray-500">
                    {settings.yellowMin}% to {settings.greenMin - 1}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={settings.yellowMin}
                  onChange={(e) =>
                    setSettings({ ...settings, yellowMin: Number(e.target.value) })
                  }
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                />
                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={settings.yellowMin}
                    onChange={(e) =>
                      setSettings({ ...settings, yellowMin: Number(e.target.value) })
                    }
                    className="w-20 px-2 py-1 border border-gray-300 rounded text-center focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  />
                  <span className="text-sm text-gray-500">%</span>
                </div>
              </div>

              {/* Red Info */}
              <div className="p-3 bg-red-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500" />
                  <span className="text-sm font-medium text-red-800">
                    Red (Critical): Below {settings.yellowMin}%
                  </span>
                </div>
                <p className="text-xs text-red-600 mt-1">
                  Teachers scoring below the yellow threshold will be flagged as needing immediate
                  attention.
                </p>
              </div>
            </div>
          </Card>

          {/* Aggregation Mode */}
          <Card>
            <CardTitle>
              <Sliders className="w-5 h-5 text-primary-600 mr-2" />
              Score Aggregation Mode
            </CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              Choose how element scores are combined into column and overall scores.
            </p>

            <div className="mt-4 space-y-3">
              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="aggregationMode"
                  value="weighted"
                  checked={settings.aggregationMode === 'weighted'}
                  onChange={() => setSettings({ ...settings, aggregationMode: 'weighted' })}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-gray-900">Weighted Average</p>
                  <p className="text-sm text-gray-600">
                    Calculate the average score weighted by element importance. Best for balanced
                    overall assessment.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="aggregationMode"
                  value="worst"
                  checked={settings.aggregationMode === 'worst'}
                  onChange={() => setSettings({ ...settings, aggregationMode: 'worst' })}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-gray-900">Worst Score</p>
                  <p className="text-sm text-gray-600">
                    Use the lowest scoring element to determine the overall status. Highlights areas
                    needing the most improvement.
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors">
                <input
                  type="radio"
                  name="aggregationMode"
                  value="majority"
                  checked={settings.aggregationMode === 'majority'}
                  onChange={() => setSettings({ ...settings, aggregationMode: 'majority' })}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-gray-900">Majority Color</p>
                  <p className="text-sm text-gray-600">
                    Assign the color that appears most frequently among elements. Useful for seeing
                    overall patterns.
                  </p>
                </div>
              </label>
            </div>
          </Card>
        </div>

        {/* Preview Panel */}
        <div className="space-y-6">
          <Card>
            <CardTitle>
              <BarChart3 className="w-5 h-5 text-primary-600 mr-2" />
              Live Preview
            </CardTitle>
            <p className="text-sm text-gray-600 mt-1">
              See how different scores would appear with your current settings.
            </p>

            <div className="mt-4 space-y-2">
              {[95, 85, 75, 65, 55, 45].map((score) => (
                <div key={score} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-12">{score}%</span>
                  <div className={`w-4 h-4 rounded-full ${getColorPreview(score)}`} />
                  <span className="text-sm text-gray-500">
                    {score >= settings.greenMin
                      ? 'On Track'
                      : score >= settings.yellowMin
                      ? 'Needs Attention'
                      : 'Critical'}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="bg-blue-50 border-blue-200">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800">About Thresholds</p>
                <p className="text-xs text-blue-700 mt-1">
                  Changes to thresholds will immediately affect how teacher performance is displayed
                  across the platform. Historical data will be re-colored based on the new
                  thresholds.
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 pt-4 border-t border-gray-200">
        <Button
          onClick={handleSave}
          isLoading={saving}
          disabled={!hasChanges}
          leftIcon={<Save className="w-4 h-4" />}
        >
          Save Settings
        </Button>
        <Button variant="secondary" onClick={handleReset} disabled={!hasChanges}>
          Reset Changes
        </Button>
        <Button
          variant="ghost"
          onClick={handleRestoreDefaults}
          leftIcon={<RefreshCw className="w-4 h-4" />}
        >
          Restore Defaults
        </Button>
        {hasChanges && (
          <span className="text-sm text-orange-600 ml-auto">You have unsaved changes</span>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
