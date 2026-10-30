import React, { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { TripContract } from '../../schema/src/trip-contract';
import type {
  Envelope,
  Assessment,
  EvidenceDocument,
  DisruptionEvent,
  RuleAdvice,
  Review,
  RouteVersion,
  ChecklistItem,
  Session,
} from '../../schema/src/domain';
import './style.css';
import { OfflineViewer } from './offline';
import { PlanningWorkbench } from './planning-workbench';
import { EvidenceAssist } from './evidence-assist';
import { DocumentRetention } from './document-retention';
import { formatMinor } from './format-money';
import { LiteralFacts } from './literal-facts';

type Locale = 'pt-BR' | 'en';
type Service = TripContract['services'][number];
const labels: Record<string, [string, string]> = {
  planning: ['Planejamento e rateio', 'Planning & allocation'],
  overview: ['Visão geral', 'Overview'],
  contracts: ['Reservas e condições', 'Bookings & terms'],
  documents: ['Documentos e provas', 'Documents & evidence'],
  events: ['Ocorrências', 'Disruptions'],
  dossier: ['Dossiê e exportações', 'Dossier & exports'],
  routes: ['Rotas', 'Routes'],
  reviews: ['Avaliações', 'Reviews'],
  settings: ['Privacidade e acesso', 'Privacy & access'],
  REGISTRATION_FORMAT_INVALID: [
    'Formato ou dígitos do CNPJ não conferem',
    'CNPJ format or check digits do not match',
  ],
  PRICE_UNKNOWN: ['Custo total não informado', 'Total price unknown'],
  POLICY_UNKNOWN: ['Política de cancelamento ausente', 'Cancellation policy missing'],
  CONTACT_UNKNOWN: ['Contato do fornecedor ausente', 'Supplier contact missing'],
  REGISTRATION_INACTIVE: ['Cadastro informado como inativo', 'Registration reported inactive'],
  CADASTUR_INACTIVE: [
    'Cadastur exigível informado como inativo',
    'Required Cadastur reported inactive',
  ],
  PAYMENT_CHANNEL_CHANGED: [
    'Pagamento fora do canal combinado',
    'Payment outside the agreed channel',
  ],
  CONFIRMATION_FAILED: ['Confirmação com o fornecedor falhou', 'Supplier confirmation failed'],
  REFERENCE_MISSING: ['Reserva sem localizador', 'Booking reference missing'],
  EVIDENCE_MISSING: ['Reserva sem comprovante anexado', 'No booking evidence attached'],
  CONFIRMATION_PENDING: ['Confirmação direta pendente', 'Direct confirmation pending'],
  TIMEZONE_UNKNOWN: ['Fuso horário não informado', 'Time zone unknown'],
  CANCELLATION_DEADLINE: ['Prazo de cancelamento próximo', 'Cancellation deadline approaching'],
  REQUIREMENT_UNCONFIRMED: [
    'Requisito de viagem sem confirmação',
    'Travel requirement unconfirmed',
  ],
  CONNECTION_CANCELLED: [
    'Conexão depende de serviço cancelado',
    'Connection depends on cancelled service',
  ],
  CONNECTION_UNVERIFIABLE: ['Conexão sem horários verificáveis', 'Connection cannot be checked'],
  CONNECTION_BUFFER: ['Margem de conexão insuficiente', 'Insufficient connection buffer'],
  OVERNIGHT_UNCOVERED: ['Pernoite sem cobertura registrada', 'Overnight coverage missing'],
  PROVIDER_CONTACT: ['Contato do fornecedor', 'Supplier contact'],
  CANCELLATION_POLICY: ['Condições de cancelamento', 'Cancellation terms'],
  TOTAL_PRICE: ['Custo total', 'Total price'],
  REGISTRATION_CHECK: ['Conferência cadastral', 'Registration check'],
  CADASTUR_CHECK: ['Conferência do Cadastur', 'Cadastur check'],
  RESERVATION_REFERENCE: ['Localizador da reserva', 'Booking reference'],
  PROVIDER_CONFIRMATION: ['Confirmação direta', 'Direct confirmation'],
  EVIDENCE_ATTACHED: ['Comprovante anexado', 'Evidence attached'],
  BAGGAGE_TERMS: ['Franquia de bagagem', 'Baggage allowance'],
  LOCAL_TIME_CONFIRMED: ['Horário local e fuso', 'Local time and zone'],
  AIR_COMMUNICATION_LEGACY: [
    'Regra histórica de comunicação; revogada a partir de 26/10/2026.',
    'Historical communication rule; revoked from 2026-10-26.',
  ],
  AIR_FOOD: [
    'Verificar alimentação para espera superior a duas horas, condições excepcionais e formas alternativas de assistência.',
    'Check food assistance after more than two hours, exceptional conditions and alternative assistance.',
  ],
  AIR_LODGING: [
    'Verificar hospedagem e traslado: pernoite, assistência especial, residência na origem e exceções influenciam a aplicação.',
    'Check lodging and transfers: overnight need, special assistance, residence at origin and exceptions affect applicability.',
  ],
  AIR_INFORMATION: [
    'Verificar informações atualizadas sobre ocorrência, alternativas e assistência, com data e horário nos canais digitais.',
    'Check updated disruption, alternatives and assistance information, with timestamps on digital channels.',
  ],
  BUS_ALTERNATIVES: [
    'Verificar as alternativas do art. 179 para atraso da partida superior a uma hora em serviço regular interestadual.',
    'Check article 179 alternatives for departure delays over one hour on regular interstate service.',
  ],
  BUS_CONTINUITY: [
    'Verificar continuidade, alimentação, hospedagem e eventual restituição conforme a escolha do passageiro e as exceções dos arts. 181–182.',
    'Check continuity, meals, lodging and possible refund according to passenger choice and articles 181–182 exceptions.',
  ],
  flight: ['Voo', 'Flight'],
  bus: ['Ônibus', 'Bus'],
  hotel: ['Hotel', 'Hotel'],
  rental_home: ['Temporada', 'Rental home'],
  activity: ['Passeio', 'Activity'],
  car_rental: ['Locação', 'Car rental'],
  insurance: ['Seguro', 'Insurance'],
  transfer: ['Traslado', 'Transfer'],
};
let csrf = '';
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined)
    headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method)) headers.set('x-csrf-token', csrf);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error?.code ?? `HTTP_${response.status}`);
  }
  return response.json() as Promise<T>;
}
function Icon({ name = 'compass' }: { name?: string }) {
  const paths: Record<string, string> = {
    compass: 'm16 8-3 8-8 3 3-8z',
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    contracts: 'M6 3h12v18H6z M9 8h6 M9 12h6 M9 16h4',
    documents: 'M4 6h6l2 3h8v12H4z M4 6V3h6l2 3h8v3',
    events: 'M12 3 2 21h20z M12 9v5 M12 17v1',
    dossier: 'M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6',
    routes: 'M6 20V7a4 4 0 0 1 8 0v10a3 3 0 0 0 6 0V4 M3 17l3 3 3-3',
    reviews: 'M4 4h16v12H9l-5 5z M8 8h8 M8 12h5',
    settings: 'M12 3 4 7v5c0 5 8 9 8 9s8-4 8-9V7z M8 12l3 3 5-6',
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] ?? paths.compass} />
    </svg>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function money(minor: number, currency: string, locale: Locale) {
  return formatMinor(minor, currency, locale);
}

function App() {
  const [locale, setLocale] = useState<Locale>('pt-BR'),
    [session, setSession] = useState<(Session & { mode: string; role: string }) | null>(null),
    [tab, setTab] = useState('overview'),
    [trips, setTrips] = useState<Envelope<TripContract>[]>([]),
    [selected, setSelected] = useState<Envelope<TripContract> | null>(null),
    [assessment, setAssessment] = useState<Assessment | null>(null),
    [documents, setDocuments] = useState<EvidenceDocument[]>([]),
    [events, setEvents] = useState<Array<{ event: DisruptionEvent; advice: RuleAdvice[] }>>([]),
    [checks, setChecks] = useState<ChecklistItem[]>([]),
    [reviews, setReviews] = useState<Envelope<Review>[]>([]),
    [routes, setRoutes] = useState<Envelope<RouteVersion>[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [editing, setEditing] = useState<Service | null>(null),
    [contractText, setContractText] = useState(''),
    [claim, setClaim] = useState(''),
    [passphrase, setPassphrase] = useState(''),
    [dossierText, setDossierText] = useState(''),
    [calendarPrivate, setCalendarPrivate] = useState(false);
  useEffect(() => {
    if (!selected || !documents.some((doc) => doc.status === 'quarantined')) return;
    const timer = setTimeout(() => {
      void load(selected.id).catch(() => setError('DOCUMENT_REFRESH_FAILED'));
    }, 1500);
    return () => clearTimeout(timer);
  }, [selected?.id, documents]);
  const t = (pt: string, en: string) => (locale === 'pt-BR' ? pt : en);
  const label = (code: string) => labels[code]?.[locale === 'pt-BR' ? 0 : 1] ?? code;
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'REQUEST_FAILED');
    } finally {
      setBusy(false);
    }
  };
  const load = async (id?: string) => {
    const list = await api<Envelope<TripContract>[]>('/v1/trips');
    setTrips(list);
    const trip = list.find((item) => item.id === (id ?? selected?.id)) ?? list[0] ?? null;
    setSelected(trip);
    setContractText(trip ? JSON.stringify(trip.data, null, 2) : '');
    if (trip) {
      const [a, d, e, c, r, rt] = await Promise.all([
        api<Assessment>(`/v1/trips/${trip.id}/assessment`),
        api<EvidenceDocument[]>(`/v1/trips/${trip.id}/documents`),
        api<Array<{ event: DisruptionEvent; advice: RuleAdvice[] }>>(`/v1/trips/${trip.id}/events`),
        api<ChecklistItem[]>(`/v1/trips/${trip.id}/checklists`),
        api<Envelope<Review>[]>('/v1/reviews'),
        api<Envelope<RouteVersion>[]>('/v1/routes'),
      ]);
      setAssessment(a);
      setDocuments(d);
      setEvents(e);
      setChecks(c);
      setReviews(r);
      setRoutes(rt);
    } else {
      setAssessment(null);
      setDocuments([]);
      setEvents([]);
    }
  };
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    void (async () => {
      try {
        const identity = await api<Session & { mode: string; role: string }>('/auth/session');
        csrf = identity.csrf;
        setSession(identity);
        await load();
      } catch {
        /* Explicit login screen; no implicit authentication or external requests. */
      }
    })();
  }, []);
  useEffect(() => {
    if (!selected || !documents.some((d) => d.status === 'quarantined')) return;
    const timeout = setTimeout(() => void run(() => load(selected.id)), 1500);
    return () => clearTimeout(timeout);
  }, [documents, selected?.id]);
  const loginDemo = () =>
    run(async () => {
      const identity = await api<Session & { mode: string; role: string }>('/auth/demo', {
        method: 'POST',
      });
      csrf = identity.csrf;
      setSession(identity);
      const trip = await api<Envelope<TripContract>>('/v1/trips/demo', { method: 'POST' });
      await load(trip.id);
    });
  const saveContract = async (trip: TripContract) => {
    if (!selected) return;
    await api(`/v1/trips/${selected.id}`, {
      method: 'PUT',
      headers: { 'if-match': String(selected.version) },
      body: JSON.stringify(trip),
    });
    await load(selected.id);
    setNotice(t('Alteração registrada.', 'Change recorded.'));
  };
  const createTrip = () =>
    run(async () => {
      const id = crypto.randomUUID(),
        today = new Date().toISOString().slice(0, 10);
      const trip: TripContract = {
        schemaVersion: '1.0.0',
        id,
        title: t('Nova viagem', 'New trip'),
        country: 'BR',
        currency: 'BRL',
        locale,
        startDate: today,
        endDate: today,
        travelers: [],
        services: [],
        dependencies: [],
        overnightExemptions: [],
      };
      await api('/v1/trips', { method: 'POST', body: JSON.stringify(trip) });
      await load(id);
      setTab('contracts');
    });
  const newService = (): Service => ({
    id: crypto.randomUUID(),
    kind: 'hotel',
    title: '',
    country: selected?.data.country ?? 'BR',
    regulatoryScope: 'unknown',
    provider: {
      name: '',
      category: 'hotel',
      registration: {
        scheme: null,
        value: null,
        status: 'unknown',
        sourceUrl: null,
        checkedAt: null,
      },
      cadastur: { applicability: 'unknown', status: 'unknown', sourceUrl: null, checkedAt: null },
      contact: null,
    },
    reservation: {
      state: 'quote',
      reference: null,
      confirmation: 'not_checked',
      confirmationDocumentId: null,
      paymentChannel: 'unknown',
    },
    start: { local: `${selected?.data.startDate ?? '2030-01-01'}T15:00`, timeZone: null },
    end: { local: `${selected?.data.endDate ?? '2030-01-01'}T11:00`, timeZone: null },
    price: null,
    cancellation: { summary: null, deadline: null, documentId: null },
    baggage: null,
    documentIds: [],
    requirements: [],
  });
  const download = async (path: string, filename: string, body?: unknown) => {
    const response = await fetch(
      path,
      body
        ? {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
            body: JSON.stringify(body),
          }
        : {},
    );
    if (!response.ok) {
      const detail = await response.json();
      throw new Error(detail.error?.code ?? 'EXPORT_FAILED');
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <img src="/icon.svg" alt="" />
          <span>
            Travel
            <br />
            <strong>Reliability</strong>
          </span>
        </a>
        <div className="sidebar-label">{t('SUA VIAGEM, VERIFICÁVEL', 'YOUR TRIP, VERIFIABLE')}</div>
        <nav aria-label={t('Navegação principal', 'Main navigation')}>
          {Object.keys(labels)
            .filter((key) =>
              [
                'overview',
                'planning',
                'contracts',
                'documents',
                'events',
                'dossier',
                'routes',
                'reviews',
                'settings',
              ].includes(key),
            )
            .map((key) => (
              <button
                key={key}
                className={tab === key ? 'nav-item active' : 'nav-item'}
                onClick={() => setTab(key)}
              >
                <Icon name={key} />
                {label(key)}
                {key === 'documents' && documents.length > 0 && <small>{documents.length}</small>}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-mark">
            <Icon name="settings" />
            <span>{t('Provas privadas por padrão', 'Evidence private by default')}</span>
          </div>
          <p>
            {t(
              'Sem compra automática. Sem promessas de resultado.',
              'No automatic purchases. No outcome promises.',
            )}
          </p>
          <small>OPEN SOURCE · v0.1.0</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span className="breadcrumb">
            {t('Workspace privado', 'Private workspace')}
            <span>/</span>
            <strong>{label(tab)}</strong>
          </span>
          <div className="top-actions">
            <span className="status-dot">
              {session?.demo
                ? t('Demonstração sintética', 'Synthetic demonstration')
                : t('Dados sob seu controle', 'Data under your control')}
            </span>
            <label className="sr-only" htmlFor="language">
              Language
            </label>
            <select
              id="language"
              value={locale}
              onChange={(e) => setLocale(e.target.value as Locale)}
            >
              <option value="pt-BR">Português</option>
              <option value="en">English</option>
            </select>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">TRAVEL RELIABILITY LAYER</p>
              <h1>
                {session
                  ? label(tab)
                  : t(
                      'Viaje com um plano. E com provas.',
                      'Travel with a plan. And with evidence.',
                    )}
              </h1>
              <p className="subtitle">
                {t(
                  'Condições claras, lacunas visíveis e documentos organizados.',
                  'Clear terms, visible gaps and organized documents.',
                )}
              </p>
            </div>
            {session && (
              <button className="primary" onClick={createTrip} disabled={busy}>
                + {t('Nova viagem', 'New trip')}
              </button>
            )}
          </div>
          {error && (
            <div className="message error" role="alert">
              {t('A operação não foi concluída.', 'The operation did not complete.')}{' '}
              <code>{error}</code>
              <button onClick={() => setError('')}>{t('Fechar', 'Dismiss')}</button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              {notice}
            </div>
          )}
          {busy && (
            <div className="loading" role="status">
              {t('Processando…', 'Processing…')}
            </div>
          )}
          {!session ? (
            <section className="welcome panel">
              <div className="welcome-illustration">
                <Icon />
              </div>
              <h2>
                {t(
                  'Da reserva ao imprevisto, preserve o que importa.',
                  'From booking to disruption, preserve what matters.',
                )}
              </h2>
              <p>
                {t(
                  'Explore uma viagem fictícia com conexão apertada e uma noite sem hospedagem. Nenhuma informação real é necessária e nenhum modelo de IA é acionado.',
                  'Explore a fictional trip with a tight connection and an uncovered night. No real information is needed and no AI model is called.',
                )}
              </p>
              <div className="button-row">
                <button className="primary" onClick={loginDemo} disabled={busy}>
                  {t('Explorar demonstração', 'Explore demo')}
                </button>
                <a className="button secondary" href="/auth/login">
                  {t('Entrar com OIDC', 'Sign in with OIDC')}
                </a>
                <a className="text-link" href="/?offline=1">
                  {t('Abrir pacote offline', 'Open offline bundle')}
                </a>
              </div>
              <div className="welcome-features">
                <span>01 · {t('Compare condições', 'Compare terms')}</span>
                <span>02 · {t('Preserve documentos', 'Preserve documents')}</span>
                <span>03 · {t('Organize uma reclamação', 'Organize a claim')}</span>
              </div>
            </section>
          ) : (
            <>
              <div className="trip-selector">
                <div>
                  <span className="mini-label">{t('VIAGEM ATUAL', 'CURRENT TRIP')}</span>
                  <label className="sr-only" htmlFor="trip">
                    {t('Selecionar viagem', 'Select trip')}
                  </label>
                  <select
                    id="trip"
                    value={selected?.id ?? ''}
                    onChange={(e) => void run(() => load(e.target.value))}
                  >
                    <option value="" disabled>
                      {t('Selecione uma viagem', 'Select a trip')}
                    </option>
                    {trips.map((trip) => (
                      <option key={trip.id} value={trip.id}>
                        {trip.data.title}
                      </option>
                    ))}
                  </select>
                </div>
                {selected && (
                  <span>
                    {selected.data.startDate} <span className="muted">→</span>{' '}
                    {selected.data.endDate} <span className="chip">{selected.data.country}</span>
                  </span>
                )}
              </div>
              {!selected ? (
                <div className="panel empty">
                  <h2>{t('Seu workspace está vazio.', 'Your workspace is empty.')}</h2>
                  <button className="primary" onClick={createTrip}>
                    {t('Criar viagem', 'Create trip')}
                  </button>
                </div>
              ) : (
                <>
                  {tab === 'planning' && (
                    <PlanningWorkbench
                      locale={locale}
                      execute={(tool, value) =>
                        api(`/v1/tools/${tool}`, { method: 'POST', body: JSON.stringify(value) })
                      }
                    />
                  )}
                  {tab === 'overview' && assessment && (
                    <>
                      <div className="metrics">
                        <article className="metric">
                          <span>{t('Cobertura de informações', 'Information coverage')}</span>
                          <strong>
                            {assessment.informationCoveragePercent}
                            <small>%</small>
                          </strong>
                          <meter
                            min="0"
                            max="100"
                            value={assessment.informationCoveragePercent}
                            aria-label={t('Cobertura de informações', 'Information coverage')}
                          />
                          <p>
                            {t(
                              'Campos conhecidos; não é nota de segurança.',
                              'Known fields; not a safety rating.',
                            )}
                          </p>
                        </article>
                        <article className="metric">
                          <span>{t('Alertas críticos', 'Critical findings')}</span>
                          <strong className="danger-text">
                            {assessment.findings
                              .filter((f) => f.severity === 'critical')
                              .length.toString()
                              .padStart(2, '0')}
                          </strong>
                          <p>
                            {t(
                              'Confira antes de confirmar o plano.',
                              'Check before confirming the plan.',
                            )}
                          </p>
                        </article>
                        <article className="metric">
                          <span>{t('Documentos preservados', 'Preserved documents')}</span>
                          <strong>{documents.length.toString().padStart(2, '0')}</strong>
                          <p>
                            {t(
                              'Originais e extrações têm estados distintos.',
                              'Originals and extractions have distinct states.',
                            )}
                          </p>
                        </article>
                        <article className="metric">
                          <span>{t('Custo conhecido', 'Known cost')}</span>
                          <strong className="money-total">
                            {Object.entries(assessment.totals).map(([currency, total]) => (
                              <span key={currency}>{money(total, currency, locale)}</span>
                            ))}
                          </strong>
                          <p>
                            {t(
                              'Somente itens com preço informado.',
                              'Only items with a recorded price.',
                            )}
                          </p>
                        </article>
                      </div>
                      <div className="content-grid">
                        <section className="panel">
                          <div className="section-title">
                            <h2>{t('O que precisa de atenção', 'What needs attention')}</h2>
                            <span className="chip">{assessment.findings.length}</span>
                          </div>
                          <p className="muted small">
                            {t(
                              'Ausência de informação permanece visível; não vira confirmação.',
                              'Missing information stays visible; it does not become confirmation.',
                            )}
                          </p>
                          <div className="findings">
                            {[...assessment.findings]
                              .sort(
                                (a, b) =>
                                  ({ critical: 0, warning: 1, info: 2 })[a.severity] -
                                  { critical: 0, warning: 1, info: 2 }[b.severity],
                              )
                              .map((f, index) => (
                                <article className={`finding ${f.severity}`} key={index}>
                                  <span className="finding-dot" />
                                  <div>
                                    <strong>{label(f.code)}</strong>
                                    <p>
                                      {f.serviceId
                                        ? selected.data.services.find((s) => s.id === f.serviceId)
                                            ?.title
                                        : t('Plano da viagem', 'Trip plan')}
                                      {Object.entries(f.parameters).length > 0 &&
                                        ` · ${Object.entries(f.parameters)
                                          .map(([key, value]) => `${key}: ${value}`)
                                          .join(' · ')}`}
                                    </p>
                                  </div>
                                </article>
                              ))}
                          </div>
                          <button className="text-link" onClick={() => setTab('contracts')}>
                            {t('Revisar reservas e condições →', 'Review bookings and terms →')}
                          </button>
                        </section>
                        <section className="panel itinerary">
                          <div className="section-title">
                            <h2>{t('Sequência da viagem', 'Trip sequence')}</h2>
                            <span className="chip">{selected.data.services.length}</span>
                          </div>
                          {selected.data.services.map((s) => (
                            <article className="timeline-item" key={s.id}>
                              <div className="timeline-marker">
                                <Icon name={s.kind === 'hotel' ? 'contracts' : 'routes'} />
                              </div>
                              <div>
                                <span className="mini-label">
                                  {label(s.kind)} · {s.start.local.slice(11)}
                                </span>
                                <h3>{s.title}</h3>
                                <p>
                                  {s.start.local.slice(0, 10)} · {s.provider.name}
                                </p>
                                <span className="tag">
                                  {t('Confirmação', 'Confirmation')}: {s.reservation.confirmation}
                                </span>
                              </div>
                            </article>
                          ))}
                          <div className="note">
                            {t(
                              'Uma conexão viável depende de horários, fuso e margem registrada.',
                              'A feasible connection depends on times, time zone and a recorded buffer.',
                            )}
                          </div>
                        </section>
                      </div>
                      <section className="panel checklist">
                        <div className="section-title">
                          <h2>{t('Antes de embarcar', 'Before departure')}</h2>
                          <span>
                            {checks.filter((c) => c.status === 'complete').length}/
                            {checks.filter((c) => c.status !== 'not_applicable').length}
                          </span>
                        </div>
                        <div className="check-grid">
                          {checks
                            .filter((c) => c.status !== 'not_applicable')
                            .map((c, index) => (
                              <div
                                className={
                                  c.status === 'complete' ? 'check-item done' : 'check-item'
                                }
                                key={index}
                              >
                                <span aria-hidden="true">
                                  {c.status === 'complete' ? '✓' : '○'}
                                </span>
                                <div>
                                  {label(c.code)}
                                  <small>
                                    {
                                      selected.data.services.find((s) => s.id === c.serviceId)
                                        ?.title
                                    }
                                  </small>
                                </div>
                              </div>
                            ))}
                        </div>
                      </section>
                    </>
                  )}
                  {tab === 'contracts' && (
                    <>
                      <section className="panel">
                        <div className="section-title">
                          <h2>{t('Serviços da viagem', 'Trip services')}</h2>
                          <button className="primary" onClick={() => setEditing(newService())}>
                            {t('Adicionar serviço', 'Add service')}
                          </button>
                        </div>
                        <div className="service-grid">
                          {selected.data.services.map((s) => (
                            <article className="service-card" key={s.id}>
                              <span className="mini-label">
                                {label(s.kind)} · {s.reservation.state}
                              </span>
                              <h3>{s.title}</h3>
                              <p>{s.provider.name}</p>
                              <p>
                                {s.start.local} ·{' '}
                                {s.start.timeZone ?? t('fuso desconhecido', 'unknown zone')}
                              </p>
                              <strong>
                                {s.price
                                  ? money(s.price.totalMinor, s.price.currency, locale)
                                  : t('Preço desconhecido', 'Price unknown')}
                              </strong>
                              <button
                                className="secondary"
                                onClick={() => setEditing(structuredClone(s))}
                              >
                                {t('Revisar condições', 'Review terms')}
                              </button>
                            </article>
                          ))}
                        </div>
                      </section>
                      <section className="panel">
                        <details>
                          <summary>
                            {t('Contrato completo · editar JSON', 'Complete contract · edit JSON')}
                          </summary>
                          <p className="muted">
                            {t(
                              'Inclui datas, viajantes, conexões, requisitos e exceções de pernoite. Alterações passam por validação.',
                              'Includes dates, travelers, connections, requirements and overnight exceptions. Changes are validated.',
                            )}
                          </p>
                          <label className="sr-only" htmlFor="contract-json">
                            Trip Contract JSON
                          </label>
                          <textarea
                            id="contract-json"
                            className="code-editor"
                            value={contractText}
                            onChange={(e) => setContractText(e.target.value)}
                            spellCheck={false}
                          />
                          <button
                            className="primary"
                            onClick={() =>
                              void run(async () =>
                                saveContract(JSON.parse(contractText) as TripContract),
                              )
                            }
                          >
                            {t('Validar e salvar contrato', 'Validate and save contract')}
                          </button>
                        </details>
                      </section>
                    </>
                  )}
                  {tab === 'documents' && (
                    <>
                      <section className="panel upload-panel">
                        <Icon name="documents" />
                        <div>
                          <h2>
                            {t(
                              'Preserve o original antes de extrair.',
                              'Preserve the original before extracting.',
                            )}
                          </h2>
                          <p>
                            {t(
                              'Texto e JSON funcionam sem serviços externos. PDF, imagem, EML, HTML e DOCX exigem o worker isolado. Extrações sempre pedem revisão.',
                              'Text and JSON work without external services. PDF, image, EML, HTML and DOCX require the isolated worker. Extractions always require review.',
                            )}
                          </p>
                        </div>
                        <label className="button primary">
                          {t('Importar documento', 'Import document')}
                          <input
                            className="sr-only"
                            type="file"
                            accept=".txt,.json,.pdf,.png,.jpg,.jpeg,.eml,.html,.docx"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              void run(async () => {
                                const form = new FormData();
                                form.append('file', file);
                                await api(`/v1/trips/${selected.id}/documents`, {
                                  method: 'POST',
                                  body: form,
                                });
                                await load(selected.id);
                              });
                              e.target.value = '';
                            }}
                          />
                        </label>
                      </section>
                      {documents.length === 0 && (
                        <div className="panel empty">
                          {t(
                            'Nenhum documento importado. Use um comprovante sintético para experimentar.',
                            'No documents imported. Use a synthetic receipt to try the workflow.',
                          )}
                        </div>
                      )}
                      {documents.map((doc) => (
                        <section className="panel" key={doc.id}>
                          <div className="section-title">
                            <h2>{doc.label}</h2>
                            <span className="tag">{doc.status}</span>
                          </div>
                          <p className="muted small">
                            {doc.mediaType} · {doc.bytes} bytes · SHA-256 <code>{doc.sha256}</code>
                          </p>
                          {doc.warnings.map((w) => (
                            <p key={w} className="warning-text">
                              {w}
                            </p>
                          ))}
                          <LiteralFacts facts={doc.facts ?? []} locale={locale} />
                          {doc.fields.map((f, i) => (
                            <div className="extracted-field" key={i}>
                              <span className="mini-label">
                                {f.path} · {f.method} ·{' '}
                                {t('extraído, não confirmado', 'extracted, not confirmed')}
                              </span>
                              <p>{String(f.value)}</p>
                              <blockquote>{f.source.quote}</blockquote>
                              <div className="button-row">
                                <label className="sr-only" htmlFor={`${doc.id}-${i}`}>
                                  {t('Serviço de destino', 'Target service')}
                                </label>
                                <select id={`${doc.id}-${i}`} defaultValue="">
                                  <option value="" disabled>
                                    {t('Aplicar a um serviço…', 'Apply to a service…')}
                                  </option>
                                  {selected.data.services.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.title}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  className="secondary"
                                  onClick={() =>
                                    void run(async () => {
                                      const serviceId = (
                                        document.getElementById(
                                          `${doc.id}-${i}`,
                                        ) as HTMLSelectElement
                                      ).value;
                                      if (!serviceId) throw new Error('SELECT_SERVICE');
                                      await api(`/v1/documents/${doc.id}/apply`, {
                                        method: 'POST',
                                        body: JSON.stringify({
                                          serviceId,
                                          fieldIndexes: [i],
                                          expectedVersion: selected.version,
                                        }),
                                      });
                                      await load(selected.id);
                                    })
                                  }
                                >
                                  {t('Revisar e aplicar', 'Review and apply')}
                                </button>
                              </div>
                            </div>
                          ))}
                          <DocumentRetention
                            expiry={doc.expiresAt}
                            locale={locale}
                            update={async (expiresAt) => {
                              await api(`/v1/documents/${doc.id}/retention`, {
                                method: 'PUT',
                                body: JSON.stringify({ expiresAt }),
                              });
                              await load(selected.id);
                            }}
                          />
                          <EvidenceAssist
                            id={doc.id}
                            locale={locale}
                            request={api}
                            refresh={() => load(selected.id)}
                          />
                          <div className="button-row">
                            <a
                              className="button secondary"
                              href={`/v1/documents/${doc.id}/original`}
                            >
                              {t('Baixar original', 'Download original')}
                            </a>
                            <button
                              className="danger"
                              onClick={() => {
                                if (
                                  confirm(
                                    t(
                                      'Excluir original, extração e referências vinculadas?',
                                      'Delete original, extraction and linked references?',
                                    ),
                                  )
                                )
                                  void run(async () => {
                                    await api(`/v1/documents/${doc.id}`, { method: 'DELETE' });
                                    await load(selected.id);
                                  });
                              }}
                            >
                              {t('Excluir documento', 'Delete document')}
                            </button>
                          </div>
                        </section>
                      ))}
                    </>
                  )}
                  {tab === 'events' && (
                    <>
                      <EventForm
                        services={selected.data.services}
                        t={t}
                        onSave={(body) =>
                          run(async () => {
                            await api(`/v1/trips/${selected.id}/events`, {
                              method: 'POST',
                              body: JSON.stringify(body),
                            });
                            await load(selected.id);
                          })
                        }
                      />
                      {events.map(({ event, advice }) => (
                        <section className="panel" key={event.id}>
                          <div className="section-title">
                            <h2>{event.kind}</h2>
                            <time>{event.occurredAt}</time>
                          </div>
                          <p>{event.description}</p>
                          <p className="muted">
                            {t(
                              'Relato registrado pelo viajante; responsabilidade não determinada.',
                              'Traveler report; liability not determined.',
                            )}
                          </p>
                          {advice.length === 0 && (
                            <p>
                              {t(
                                'Sem regra publicada aplicável aos dados informados. Preserve os documentos e consulte a fonte competente.',
                                'No published rule matches the supplied facts. Preserve records and consult the competent source.',
                              )}
                            </p>
                          )}
                          {advice.map((a) => (
                            <div className="advice" key={a.ruleId}>
                              <span className="tag">
                                {a.status === 'needs_review'
                                  ? t('Aplicabilidade a confirmar', 'Applicability needs review')
                                  : t(
                                      'Hipótese compatível com os dados declarados',
                                      'Matches the declared facts',
                                    )}
                              </span>
                              <p>{label(a.messageKey)}</p>
                              <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer">
                                {a.article}
                              </a>
                            </div>
                          ))}
                        </section>
                      ))}
                    </>
                  )}
                  {tab === 'dossier' && (
                    <section className="panel">
                      <h2>
                        {t(
                          'Uma cronologia factual, com documentos.',
                          'A factual chronology, with documents.',
                        )}
                      </h2>
                      <p className="muted">
                        {t(
                          'O dossiê separa relatos, reservas e evidências. Não determina culpa, indenização ou resultado de reclamação.',
                          'The dossier separates reports, bookings and evidence. It does not determine fault, compensation or claim outcomes.',
                        )}
                      </p>
                      <Field label={t('Pedido objetivo', 'Objective request')}>
                        <textarea
                          value={claim}
                          onChange={(e) => setClaim(e.target.value)}
                          maxLength={4000}
                          placeholder={t(
                            'Descreva o que deseja solicitar ao fornecedor.',
                            'Describe what you want to request from the supplier.',
                          )}
                        />
                      </Field>
                      <div className="button-row">
                        <button
                          className="primary"
                          onClick={() =>
                            void run(async () => {
                              const report = await api(`/v1/trips/${selected.id}/dossier`, {
                                method: 'POST',
                                body: JSON.stringify({ request: claim }),
                              });
                              setDossierText(JSON.stringify(report, null, 2));
                            })
                          }
                        >
                          {t('Gerar dossiê factual', 'Generate factual dossier')}
                        </button>
                        {['json', 'pdf', 'ics'].map((format) => (
                          <button
                            className="secondary"
                            key={format}
                            onClick={() =>
                              void run(() =>
                                format === 'pdf'
                                  ? download(
                                      `/v1/trips/${selected.id}/dossier/pdf`,
                                      'dossier.pdf',
                                      { request: claim },
                                    )
                                  : download(
                                      `/v1/trips/${selected.id}/export?format=${format}${format === 'ics' ? '&privacy=' + (calendarPrivate ? 'private' : 'minimal') : ''}`,
                                      `trip.${format}`,
                                    ),
                              )
                            }
                          >
                            {format === 'ics'
                              ? t(
                                  'iCal · ' + (calendarPrivate ? 'privado' : 'mínimo'),
                                  'iCal · ' + (calendarPrivate ? 'private' : 'minimal'),
                                )
                              : format.toUpperCase()}
                          </button>
                        ))}
                      </div>
                      <label className="field">
                        <span>
                          <input
                            type="checkbox"
                            checked={calendarPrivate}
                            onChange={(e) => setCalendarPrivate(e.target.checked)}
                          />{' '}
                          {t(
                            'Incluir códigos, endereços e notas privadas no iCal',
                            'Include booking codes, addresses and private notes in iCal',
                          )}
                        </span>
                      </label>
                      {dossierText && (
                        <pre className="json-preview" tabIndex={0}>
                          {dossierText}
                        </pre>
                      )}
                      <hr />
                      <h3>
                        {t(
                          'Pacote de provas offline, criptografado',
                          'Encrypted offline evidence bundle',
                        )}
                      </h3>
                      <p>
                        {t(
                          'Inclui os originais e o manifesto. A senha não é armazenada; sua perda impede a abertura.',
                          'Includes originals and manifest. The passphrase is not stored; losing it prevents decryption.',
                        )}
                      </p>
                      <Field
                        label={t(
                          'Senha do pacote · mínimo 12 caracteres',
                          'Bundle passphrase · minimum 12 characters',
                        )}
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          minLength={12}
                          value={passphrase}
                          onChange={(e) => setPassphrase(e.target.value)}
                        />
                      </Field>
                      <div className="button-row">
                        <button
                          className="primary"
                          disabled={passphrase.length < 12}
                          onClick={() =>
                            void run(async () => {
                              await download(`/v1/trips/${selected.id}/bundle`, 'evidence.trb', {
                                passphrase,
                                request: claim,
                              });
                              setPassphrase('');
                            })
                          }
                        >
                          {t('Exportar pacote criptografado', 'Export encrypted bundle')}
                        </button>
                        <a className="text-link" href="/?offline=1">
                          {t('Abrir verificador offline →', 'Open offline verifier →')}
                        </a>
                      </div>
                    </section>
                  )}
                  {tab === 'routes' && (
                    <Routes
                      routes={routes}
                      t={t}
                      onSave={(body) =>
                        run(async () => {
                          await api('/v1/routes', { method: 'POST', body: JSON.stringify(body) });
                          await load(selected.id);
                        })
                      }
                    />
                  )}
                  {tab === 'reviews' && (
                    <Reviews
                      services={selected.data.services}
                      reviews={reviews.filter((r) => r.data.tripId === selected.id)}
                      t={t}
                      onSave={(body) =>
                        run(async () => {
                          await api('/v1/reviews', {
                            method: 'POST',
                            body: JSON.stringify({ ...body, tripId: selected.id }),
                          });
                          await load(selected.id);
                        })
                      }
                      onModerate={(id, status) =>
                        run(async () => {
                          await api(`/v1/reviews/${id}/moderate`, {
                            method: 'POST',
                            body: JSON.stringify({ status, confirmNoPersonalData: true }),
                          });
                          await load(selected.id);
                        })
                      }
                    />
                  )}
                  {tab === 'settings' && (
                    <section className="panel">
                      <h2>
                        {t('Controle de acesso e privacidade', 'Access and privacy controls')}
                      </h2>
                      <p>
                        {t(
                          'Sua identificação interna é opaca. Compartilhar o código com um proprietário permite receber acesso ao workspace dele.',
                          'Your internal identity is opaque. Sharing the code with an owner lets them grant access to their workspace.',
                        )}
                      </p>
                      <code className="break-all">{session.userId}</code>
                      <MemberForm
                        t={t}
                        onSave={(body) =>
                          run(async () => {
                            await api('/v1/workspace/members', {
                              method: 'POST',
                              body: JSON.stringify(body),
                            });
                            setNotice(t('Acesso registrado.', 'Access recorded.'));
                          })
                        }
                      />
                      <hr />
                      <div className="button-row">
                        <button
                          className="secondary"
                          onClick={() =>
                            void run(() => download('/v1/workspace/export', 'workspace.json'))
                          }
                        >
                          {t('Exportar dados do workspace', 'Export workspace data')}
                        </button>
                        <button
                          className="secondary"
                          onClick={() =>
                            void run(async () => {
                              await api('/auth/logout', { method: 'POST' });
                              setSession(null);
                              setSelected(null);
                              csrf = '';
                            })
                          }
                        >
                          {t('Sair', 'Sign out')}
                        </button>
                        <button
                          className="danger"
                          onClick={() => {
                            if (
                              confirm(
                                t(
                                  'Excluir permanentemente os dados ativos deste workspace?',
                                  'Permanently delete active data in this workspace?',
                                ),
                              )
                            )
                              void run(async () => {
                                await api('/v1/workspace', { method: 'DELETE' });
                                setSession(null);
                                setSelected(null);
                                csrf = '';
                              });
                          }}
                        >
                          {t('Excluir workspace', 'Delete workspace')}
                        </button>
                      </div>
                      <p className="small muted">
                        {t(
                          'Retenção de backups depende da configuração do operador. Na demonstração, os dados são efêmeros e desaparecem quando o servidor reinicia.',
                          'Backup retention depends on operator configuration. Demo data is ephemeral and disappears when the server restarts.',
                        )}
                      </p>
                    </section>
                  )}
                </>
              )}
            </>
          )}
          <footer>
            {t(
              'Dados conhecidos, lacunas explícitas, decisões suas.',
              'Known facts, explicit gaps, your decisions.',
            )}
            <a href="/schema/trip-contract.json">JSON Schema</a>
            <a href="/rules/br">{t('Fontes das regras', 'Rule sources')}</a>
          </footer>
        </main>
      </div>
      {editing && selected && (
        <ServiceEditor
          service={editing}
          documents={documents}
          t={t}
          onClose={() => setEditing(null)}
          onSave={(service) =>
            run(async () => {
              const next = structuredClone(selected.data);
              const index = next.services.findIndex((s) => s.id === service.id);
              if (index < 0) next.services.push(service);
              else next.services[index] = service;
              await saveContract(next);
              setEditing(null);
            })
          }
        />
      )}
    </div>
  );
}

type Translator = (pt: string, en: string) => string;
function ServiceEditor({
  service,
  documents,
  t,
  onClose,
  onSave,
}: {
  service: Service;
  documents: EvidenceDocument[];
  t: Translator;
  onClose: () => void;
  onSave: (service: Service) => Promise<void>;
}) {
  const [draft, setDraft] = useState(service);
  const change = (fn: (next: Service) => void) =>
    setDraft((old) => {
      const next = structuredClone(old);
      fn(next);
      return next;
    });
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className="section-title">
          <h2 id="edit-title">{t('Condições do serviço', 'Service terms')}</h2>
          <button className="secondary" onClick={onClose}>
            {t('Fechar', 'Close')}
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave(draft);
          }}
        >
          <div className="form-grid">
            <Field label={t('Título', 'Title')}>
              <input
                required
                value={draft.title}
                maxLength={200}
                onChange={(e) =>
                  change((n) => {
                    n.title = e.target.value;
                  })
                }
              />
            </Field>
            <Field label={t('Tipo', 'Type')}>
              <select
                value={draft.kind}
                onChange={(e) =>
                  change((n) => {
                    n.kind = e.target.value as Service['kind'];
                  })
                }
              >
                {[
                  'flight',
                  'bus',
                  'hotel',
                  'rental_home',
                  'activity',
                  'car_rental',
                  'insurance',
                  'transfer',
                ].map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </select>
            </Field>
            <Field label={t('Fornecedor', 'Supplier')}>
              <input
                required
                value={draft.provider.name}
                onChange={(e) =>
                  change((n) => {
                    n.provider.name = e.target.value;
                  })
                }
              />
            </Field>
            <Field label={t('Contato', 'Contact')}>
              <input
                value={draft.provider.contact ?? ''}
                onChange={(e) =>
                  change((n) => {
                    n.provider.contact = e.target.value || null;
                  })
                }
              />
            </Field>
            <Field label={t('Início local', 'Local start')}>
              <input
                type="datetime-local"
                required
                value={draft.start.local}
                onChange={(e) =>
                  change((n) => {
                    n.start.local = e.target.value;
                  })
                }
              />
            </Field>
            <Field label={t('Fim local', 'Local end')}>
              <input
                type="datetime-local"
                required
                value={draft.end.local}
                onChange={(e) =>
                  change((n) => {
                    n.end.local = e.target.value;
                  })
                }
              />
            </Field>
            <Field label={t('Fuso do início · IANA', 'Start time zone · IANA')}>
              <input
                placeholder="America/Sao_Paulo"
                value={draft.start.timeZone ?? ''}
                onChange={(e) =>
                  change((n) => {
                    n.start.timeZone = e.target.value || null;
                  })
                }
              />
            </Field>
            <Field label={t('Fuso do fim · IANA', 'End time zone · IANA')}>
              <input
                placeholder="America/Sao_Paulo"
                value={draft.end.timeZone ?? ''}
                onChange={(e) =>
                  change((n) => {
                    n.end.timeZone = e.target.value || null;
                  })
                }
              />
            </Field>
            <Field label={t('Estado', 'State')}>
              <select
                value={draft.reservation.state}
                onChange={(e) =>
                  change((n) => {
                    n.reservation.state = e.target.value as Service['reservation']['state'];
                  })
                }
              >
                {['quote', 'booked', 'cancelled', 'completed'].map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </Field>
            <Field label={t('Localizador', 'Booking reference')}>
              <input
                value={draft.reservation.reference ?? ''}
                onChange={(e) =>
                  change((n) => {
                    n.reservation.reference = e.target.value || null;
                  })
                }
              />
            </Field>
            <Field label={t('Âmbito regulatório declarado', 'Declared regulatory scope')}>
              <select
                value={draft.regulatoryScope ?? 'unknown'}
                onChange={(e) =>
                  change((n) => {
                    n.regulatoryScope = e.target.value as Service['regulatoryScope'];
                  })
                }
              >
                {['unknown', 'br_air_transport', 'br_interstate_regular_bus', 'other'].map(
                  (scope) => (
                    <option key={scope}>{scope}</option>
                  ),
                )}
              </select>
            </Field>
            <Field label={t('Canal de pagamento', 'Payment channel')}>
              <select
                value={draft.reservation.paymentChannel}
                onChange={(e) =>
                  change((n) => {
                    n.reservation.paymentChannel = e.target
                      .value as Service['reservation']['paymentChannel'];
                  })
                }
              >
                {['unknown', 'platform', 'direct', 'outside_agreed_channel'].map((channel) => (
                  <option key={channel}>{channel}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t('Política de cancelamento · literal', 'Cancellation policy · verbatim')}>
            <textarea
              value={draft.cancellation.summary ?? ''}
              maxLength={4000}
              onChange={(e) =>
                change((n) => {
                  n.cancellation.summary = e.target.value || null;
                })
              }
            />
          </Field>
          <Field label={t('Bagagem', 'Baggage')}>
            <input
              value={draft.baggage ?? ''}
              onChange={(e) =>
                change((n) => {
                  n.baggage = e.target.value || null;
                })
              }
            />
          </Field>
          <Field
            label={t(
              'Vincular comprovantes · seleção múltipla',
              'Link evidence · multiple selection',
            )}
          >
            <select
              multiple
              value={draft.documentIds}
              onChange={(e) =>
                change((n) => {
                  n.documentIds = [...e.target.selectedOptions].map((o) => o.value);
                })
              }
            >
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id}>
                  {doc.label} · {doc.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </Field>
          <p className="muted small">
            {t(
              'Preço, cadastro, política documentada e confirmação direta também podem ser editados no contrato completo.',
              'Price, registration, documented policy and direct confirmation can also be edited in the complete contract.',
            )}
          </p>
          <button className="primary" type="submit">
            {t('Validar e salvar', 'Validate and save')}
          </button>
        </form>
      </section>
    </div>
  );
}
function EventForm({
  services,
  t,
  onSave,
}: {
  services: Service[];
  t: Translator;
  onSave: (event: unknown) => Promise<void>;
}) {
  return (
    <section className="panel">
      <h2>{t('Registrar uma ocorrência', 'Record a disruption')}</h2>
      <p className="muted">
        {t(
          'Registre o que ocorreu e o que ainda não sabe. O sistema não decide responsabilidade.',
          'Record what happened and what remains unknown. The system does not decide liability.',
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          void onSave({
            serviceId: form.get('service'),
            kind: form.get('kind'),
            occurredAt: new Date(String(form.get('time'))).toISOString(),
            waitingMinutes: form.get('minutes') ? Number(form.get('minutes')) : null,
            description: form.get('description'),
            overnight: form.get('overnight') === 'on',
            specialAssistance: form.get('assistance') === 'on',
            providerResponsibility: 'unknown',
            documentIds: [],
            amountMinor: null,
            currency: null,
            phase: form.get('phase'),
            refundChoice: 'unknown',
            residentAtOrigin: null,
            exceptionalConditions: 'unknown',
          });
        }}
      >
        <div className="form-grid">
          <Field label={t('Serviço', 'Service')}>
            <select name="service" required>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Ocorrência', 'Event')}>
            <select name="kind">
              {[
                'delay',
                'cancellation',
                'denied_boarding',
                'baggage_issue',
                'lodging_issue',
                'refund_requested',
                'refund_received',
              ].map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </Field>
          <Field
            label={t(
              'Data e hora no fuso deste dispositivo',
              'Date and time in this device time zone',
            )}
          >
            <input
              name="time"
              type="datetime-local"
              required
              defaultValue={new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
                .toISOString()
                .slice(0, 16)}
            />
          </Field>
          <Field
            label={t(
              'Espera em minutos · deixe vazio se desconhecido',
              'Wait in minutes · blank if unknown',
            )}
          >
            <input name="minutes" type="number" min="0" max="43200" />
          </Field>
          <Field label={t('Etapa', 'Phase')}>
            <select name="phase">
              {['unknown', 'departure', 'in_transit', 'arrival'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label={t('Descrição factual', 'Factual description')}>
          <textarea name="description" required maxLength={4000} />
        </Field>
        <div className="button-row">
          <label>
            <input type="checkbox" name="overnight" />{' '}
            {t('Pernoite necessário', 'Overnight required')}
          </label>
          <label>
            <input type="checkbox" name="assistance" />{' '}
            {t('Assistência especial', 'Special assistance')}
          </label>
        </div>
        <button className="primary" type="submit">
          {t('Registrar e consultar fontes', 'Record and consult sources')}
        </button>
      </form>
    </section>
  );
}
function Routes({
  routes,
  t,
  onSave,
}: {
  routes: Envelope<RouteVersion>[];
  t: Translator;
  onSave: (route: unknown) => Promise<void>;
}) {
  return (
    <>
      <section className="panel">
        <h2>{t('Rota com origem da informação', 'Route with information provenance')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              title: f.get('title'),
              country: String(f.get('country')).toUpperCase(),
              segments: [
                {
                  label: f.get('segment'),
                  mode: f.get('mode'),
                  durationMinutes: f.get('duration') ? Number(f.get('duration')) : null,
                  distanceKm: null,
                  costMinor: null,
                  currency: null,
                  accessibility: 'unknown',
                  supportPoints: [],
                },
              ],
              seasonality: f.get('seasonality'),
              safetyNotes: '',
              alternative: f.get('alternative'),
              provenance: [
                {
                  url: f.get('source'),
                  license: f.get('license'),
                  checkedAt: new Date().toISOString(),
                  claim: f.get('claim'),
                },
              ],
            });
          }}
        >
          <div className="form-grid">
            {[
              ['title', t('Título', 'Title')],
              ['country', t('País · ISO 2', 'Country · ISO 2')],
              ['segment', t('Trecho', 'Segment')],
              ['duration', t('Duração em minutos · opcional', 'Duration in minutes · optional')],
              ['source', t('Fonte HTTPS', 'HTTPS source')],
              ['license', t('Licença ou condição de uso', 'License or usage terms')],
              ['claim', t('Informação sustentada pela fonte', 'Claim supported by source')],
              ['seasonality', t('Sazonalidade · opcional', 'Seasonality · optional')],
              ['alternative', t('Alternativa · opcional', 'Alternative · optional')],
            ].map(([name, title]) => (
              <Field key={name} label={title!}>
                <input
                  name={name}
                  required={!['duration', 'seasonality', 'alternative'].includes(name!)}
                  defaultValue={name === 'country' ? 'BR' : ''}
                  type={name === 'source' ? 'url' : name === 'duration' ? 'number' : 'text'}
                />
              </Field>
            ))}
            <Field label={t('Modal', 'Mode')}>
              <select name="mode">
                {['car', 'bus', 'walk', 'rail', 'flight', 'boat'].map((mode) => (
                  <option key={mode}>{mode}</option>
                ))}
              </select>
            </Field>
          </div>
          <button className="primary">
            {t('Registrar versão da rota', 'Record route version')}
          </button>
        </form>
      </section>
      {routes.map((r) => (
        <section className="panel" key={r.id}>
          <h2>
            {r.data.title} <span className="tag">v{r.version}</span>
          </h2>
          {r.data.segments.map((s, i) => (
            <p key={i}>
              {s.label} · {s.mode} · {s.durationMinutes ?? '?'} min
            </p>
          ))}
          <p>{r.data.seasonality}</p>
          {r.data.provenance.map((p, i) => (
            <p key={i}>
              <a href={p.url} target="_blank" rel="noopener noreferrer">
                {p.claim}
              </a>{' '}
              · {p.license} · {p.checkedAt.slice(0, 10)}
            </p>
          ))}
        </section>
      ))}
    </>
  );
}
function Reviews({
  services,
  reviews,
  t,
  onSave,
  onModerate,
}: {
  services: Service[];
  reviews: Envelope<Review>[];
  t: Translator;
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onModerate: (id: string, status: string) => Promise<void>;
}) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? '');
  const service = services.find((s) => s.id === serviceId);
  return (
    <>
      <section className="panel">
        <h2>{t('Avaliação contextualizada por evidência', 'Evidence-linked review')}</h2>
        <p className="muted">
          {t(
            'Anexar documento não comprova autenticidade, estadia ou qualidade. A avaliação nasce privada.',
            'An attachment does not prove authenticity, a stay or quality. Reviews start private.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void onSave({
              serviceId,
              evidenceDocumentId: f.get('document'),
              comparisons:
                f.get('advertised') || f.get('observed')
                  ? [
                      {
                        attribute: f.get('attribute'),
                        advertised: f.get('advertised') || null,
                        observed: f.get('observed') || null,
                      },
                    ]
                  : [],
              ratings: Object.fromEntries(
                ['cleanliness', 'accessibility', 'accuracy', 'service', 'resolution'].map((key) => [
                  key,
                  f.get(key) ? Number(f.get(key)) : null,
                ]),
              ),
              text: f.get('text'),
            });
          }}
        >
          <div className="form-grid">
            <Field label={t('Serviço', 'Service')}>
              <select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                {services.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('Comprovante vinculado', 'Linked evidence')}>
              <select name="document" required>
                <option value="">{t('Selecione', 'Select')}</option>
                {service?.documentIds.map((id) => (
                  <option key={id}>{id}</option>
                ))}
              </select>
            </Field>
            {['cleanliness', 'accessibility', 'accuracy', 'service', 'resolution'].map((key) => (
              <Field label={key} key={key}>
                <input name={key} type="number" min="1" max="5" placeholder="1–5" />
              </Field>
            ))}
          </div>
          <details>
            <summary>
              {t(
                'Comparar anunciado e entregue (relato)',
                'Compare advertised and delivered (report)',
              )}
            </summary>
            <Field label={t('Aspecto', 'Aspect')}>
              <select name="attribute">
                <option value="internet">Internet</option>
                <option value="beds">{t('Camas', 'Beds')}</option>
                <option value="accessibility">{t('Acessibilidade', 'Accessibility')}</option>
                <option value="cleanliness">{t('Limpeza', 'Cleanliness')}</option>
                <option value="noise">{t('Ruído', 'Noise')}</option>
                <option value="check_in">Check-in</option>
                <option value="other">{t('Outro', 'Other')}</option>
              </select>
            </Field>
            <Field label={t('Anunciado, conforme seu relato', 'Advertised, as reported')}>
              <input name="advertised" maxLength={300} />
            </Field>
            <Field label={t('Entregue, conforme seu relato', 'Delivered, as reported')}>
              <input name="observed" maxLength={300} />
            </Field>
            <p className="note">
              {t(
                'O sistema compara os textos informados. Não verifica a entrega nem decide responsabilidade.',
                'The system compares supplied statements. It does not verify delivery or determine liability.',
              )}
            </p>
          </details>
          <Field label={t('Relato sem dados pessoais', 'Account without personal data')}>
            <textarea name="text" maxLength={2000} required />
          </Field>
          <button className="primary">
            {t('Salvar avaliação privada', 'Save private review')}
          </button>
        </form>
      </section>
      {reviews.map((r) => (
        <section className="panel" key={r.id}>
          <span className="tag">{r.data.status}</span>
          <p>{r.data.text}</p>
          {r.data.comparisonSummary &&
            r.data.comparisonSummary.compared + r.data.comparisonSummary.incomplete > 0 && (
              <p className="note">
                {t('Relato de comparação: ', 'Reported comparison: ')}
                {r.data.comparisonSummary.differentText}{' '}
                {t('texto(s) diferente(s)', 'different statement(s)')} ·{' '}
                {r.data.comparisonSummary.incomplete}{' '}
                {t(
                  'incompleto(s). Não é verificação de entrega.',
                  'incomplete. Not verification of delivery.',
                )}
              </p>
            )}
          <p className="small muted">
            {t(
              'Publicar exige revisar e remover dados pessoais. O comprovante permanece privado.',
              'Publishing requires reviewing and removing personal data. Evidence remains private.',
            )}
          </p>
          <button
            className="secondary"
            onClick={() => {
              if (
                confirm(
                  t(
                    'Revisei e confirmo que o texto não contém dados pessoais. Publicar?',
                    'I reviewed and confirm the text contains no personal data. Publish?',
                  ),
                )
              )
                void onModerate(r.id, 'approved');
            }}
          >
            {t('Moderar e publicar', 'Moderate and publish')}
          </button>
        </section>
      ))}
    </>
  );
}
function MemberForm({ t, onSave }: { t: Translator; onSave: (body: unknown) => Promise<void> }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        void onSave({ userId: f.get('userId'), role: f.get('role') });
      }}
    >
      <div className="form-grid">
        <Field label={t('Código do colaborador', 'Collaborator code')}>
          <input name="userId" required />
        </Field>
        <Field label={t('Permissão', 'Role')}>
          <select name="role">
            <option value="viewer">{t('Leitura', 'Read only')}</option>
            <option value="editor">{t('Edição', 'Editor')}</option>
          </select>
        </Field>
      </div>
      <button className="secondary">{t('Registrar acesso', 'Grant access')}</button>
    </form>
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD)
  void navigator.serviceWorker.register('/sw.js');
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).get('offline') === '1' ? <OfflineViewer /> : <App />}
  </React.StrictMode>,
);
