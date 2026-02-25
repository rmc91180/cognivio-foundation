import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HomePage from '../HomePage';
import { dashboardApi } from '@/services/api';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/services/api', () => ({
  dashboardApi: {
    getSummary: vi.fn(),
  },
}));

const defaultSummary = {
  activeRubricId: 'template_123',
  activeRubricName: 'Danielson 2025',
  activeRubricVersion: 'v1.0',
  lastEditedAt: new Date().toISOString(),
  lastEditedBy: 'Admin User',
  totalTeachers: 14,
  greenTeachers: 8,
  yellowTeachers: 4,
  redTeachers: 2,
  missingGradesCount: 3,
  recentReports: [],
};

describe('HomePage interactions', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    vi.mocked(dashboardApi.getSummary).mockResolvedValue(defaultSummary as any);
  });

  it('navigates to roster when teacher roster card is activated via keyboard', async () => {
    render(<HomePage />);

    const rosterButtons = await screen.findAllByRole('button', { name: /Teacher Roster/i });
    const rosterCard = rosterButtons.find((element) => element.tagName === 'DIV');
    expect(rosterCard).toBeTruthy();
    if (!rosterCard) {
      return;
    }

    fireEvent.keyDown(rosterCard, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledWith('/roster');
  });

  it('routes rubric action to active template element setup', async () => {
    render(<HomePage />);

    const manageRubricButton = await screen.findByRole('button', { name: /Manage rubric/i });
    fireEvent.click(manageRubricButton);

    expect(mockNavigate).toHaveBeenCalledWith('/frameworks/elements?templateId=template_123');
  });

  it('routes rubric action to school setup when no active template exists', async () => {
    vi.mocked(dashboardApi.getSummary).mockResolvedValue({
      ...defaultSummary,
      activeRubricId: '',
      activeRubricName: 'No template selected',
    } as any);

    render(<HomePage />);

    const manageRubricButton = await screen.findByRole('button', { name: /Manage rubric/i });
    fireEvent.click(manageRubricButton);

    expect(mockNavigate).toHaveBeenCalledWith('/frameworks');
  });
});
