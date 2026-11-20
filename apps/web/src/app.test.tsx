import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('App walking skeleton', () => {
  it('checks the real API path and displays a successful connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(screen.getByText('Проверяем соединение…')).toBeInTheDocument();
    expect(await screen.findByText('API и PostgreSQL доступны')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/health',
      expect.objectContaining({ credentials: 'include', method: 'GET' }),
    );
  });

  it('shows failures without hiding them and can retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: 'unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByText('Не удалось подключиться')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить проверку' }));
    expect(await screen.findByText('API и PostgreSQL доступны')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
