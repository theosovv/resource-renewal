import { useEffect, useState } from 'react';
import { getHealth } from './api/client';

type ConnectionState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error' };

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState<ConnectionState>({ kind: 'loading' });

  useEffect(() => {
    const controller = new AbortController();

    getHealth(controller.signal)
      .then(() => setConnection({ kind: 'ready' }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        setConnection({ kind: 'error' });
      });

    return () => controller.abort();
  }, [attempt]);

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Resource Renewal — главная">
          <span className="brand-mark" aria-hidden="true">R</span>
          Resource Renewal
        </a>
        <span className="stage-badge">M0 · Walking skeleton</span>
      </header>

      <main className="main-content">
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">Контроль инфраструктуры</p>
          <h1 id="page-title">Продление ресурсов без потери операций</h1>
          <p className="hero-description">
            Базовый контур приложения запущен. Следующие этапы добавят заявки,
            согласование и устойчивый worker.
          </p>
        </section>

        <section className="connection-card" aria-labelledby="connection-title">
          <div className="card-heading">
            <div>
              <p className="card-kicker">Сквозная проверка</p>
              <h2 id="connection-title">Web → API → PostgreSQL</h2>
            </div>
            <span className={`status-dot status-dot--${connection.kind}`} aria-hidden="true" />
          </div>

          <div className="connection-result" role="status" aria-live="polite">
            {connection.kind === 'loading' && (
              <>
                <strong>Проверяем соединение…</strong>
                <p>Выполняется HTTP-запрос и обращение к базе данных.</p>
              </>
            )}
            {connection.kind === 'ready' && (
              <>
                <strong>API и PostgreSQL доступны</strong>
                <p>Health endpoint вернул <code>{'{ "status": "ok" }'}</code>.</p>
              </>
            )}
            {connection.kind === 'error' && (
              <>
                <strong>Не удалось подключиться</strong>
                <p>Проверьте PostgreSQL и API, затем повторите проверку.</p>
              </>
            )}
          </div>

          <div className="card-footer">
            <span className="endpoint">GET /api/v1/health</span>
            <button
              className="retry-button"
              type="button"
              disabled={connection.kind === 'loading'}
              onClick={() => {
                setConnection({ kind: 'loading' });
                setAttempt((value) => value + 1);
              }}
            >
              Повторить проверку
            </button>
          </div>
        </section>
      </main>

      <footer className="site-footer">TypeScript · NestJS · React · PostgreSQL · Prisma</footer>
    </div>
  );
}
