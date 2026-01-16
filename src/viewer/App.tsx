import React, { useState, useEffect, useCallback } from 'react'
import { marked } from 'marked'

// marked 설정
marked.setOptions({
  breaks: true,
  gfm: true
})

interface Session {
  id: string
  session_id: string
  project_path: string
  started_at: string
  ended_at: string | null
  status: string
}

interface Prompt {
  id: string
  session_id: string
  content: string
  timestamp: string
}

interface Observation {
  id: string
  session_id: string
  tool_name: string
  tool_input: string
  tool_response: string
  timestamp: string
}

interface Summary {
  id: string
  session_id: string
  summary: string
  ai_summary?: string
  summary_type?: string
  tokens: number
  created_at: string
}

interface Response {
  id: string
  session_id: string
  content: string
  timestamp: string
}

interface SearchResult {
  type: 'prompt' | 'observation' | 'response' | 'summary'
  data: Prompt | Observation | Response
  similarity: number
  source?: 'sqlite' | 'chroma' | 'hybrid'
  chroma_id?: string
}

interface Stats {
  sessions: number
  prompts: number
  observations: number
  responses: number
  summaries: number
}

const API_BASE = ''

// Icons as components
const DatabaseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="9" ry="3"/>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
  </svg>
)

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)

const SunIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
)

const MoonIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
)

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function truncateText(text: string, maxLength: number = 200): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + '...'
}

function isJsonString(str: string): boolean {
  if (!str) return false
  const trimmed = str.trim()
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
         (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function formatJsonWithHighlight(text: string, maxLength: number = 500): { isJson: boolean; html: string } {
  if (!isJsonString(text)) {
    return { isJson: false, html: '' }
  }

  try {
    const parsed = JSON.parse(text)
    const formatted = JSON.stringify(parsed, null, 2)
    const truncated = formatted.length > maxLength
      ? formatted.substring(0, maxLength) + '\n...'
      : formatted

    // Simple syntax highlighting
    const highlighted = truncated
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"([^"]+)":/g, '<span class="json-key">"$1"</span>:')
      .replace(/: "([^"]*)"/g, ': <span class="json-string">"$1"</span>')
      .replace(/: (-?\d+\.?\d*)/g, ': <span class="json-number">$1</span>')
      .replace(/: (true|false)/g, ': <span class="json-boolean">$1</span>')
      .replace(/: (null)/g, ': <span class="json-null">$1</span>')

    return { isJson: true, html: highlighted }
  } catch {
    return { isJson: false, html: '' }
  }
}

export default function App() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')
  const [activeTab, setActiveTab] = useState<'sessions' | 'prompts' | 'observations' | 'responses' | 'summaries' | 'search'>('prompts')
  const [sessions, setSessions] = useState<Session[]>([])
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [observations, setObservations] = useState<Observation[]>([])
  const [summaries, setSummaries] = useState<Summary[]>([])
  const [responses, setResponses] = useState<Response[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMethod, setSearchMethod] = useState<'hybrid' | 'sqlite' | 'semantic'>('hybrid')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchInfo, setSearchInfo] = useState<{ method: string; total: number } | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [stats, setStats] = useState<Stats>({ sessions: 0, prompts: 0, observations: 0, responses: 0, summaries: 0 })

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [sessionsRes, promptsRes, observationsRes, responsesRes, summariesRes] = await Promise.all([
        fetch(`${API_BASE}/api/sessions?limit=50`),
        fetch(`${API_BASE}/api/prompts?limit=50`),
        fetch(`${API_BASE}/api/observations?limit=50`),
        fetch(`${API_BASE}/api/responses?limit=50`),
        fetch(`${API_BASE}/api/summaries?limit=50`)
      ])

      const sessionsData = await sessionsRes.json()
      const promptsData = await promptsRes.json()
      const observationsData = await observationsRes.json()
      const responsesData = await responsesRes.json()
      const summariesData = await summariesRes.json()

      setSessions(sessionsData.sessions || [])
      setPrompts(promptsData.prompts || [])
      setObservations(observationsData.observations || [])
      setResponses(responsesData.responses || [])
      setSummaries(summariesData.summaries || [])

      setStats({
        sessions: sessionsData.sessions?.length || 0,
        prompts: promptsData.prompts?.length || 0,
        observations: observationsData.observations?.length || 0,
        responses: responsesData.responses?.length || 0,
        summaries: summariesData.summaries?.length || 0
      })
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchData, 30000)
    return () => clearInterval(interval)
  }, [fetchData])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const handleSearch = async () => {
    if (!searchQuery.trim()) return

    setIsSearching(true)
    setActiveTab('search')
    try {
      const response = await fetch(`${API_BASE}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery,
          limit: 20,
          method: searchMethod
        })
      })
      const data = await response.json()
      setSearchResults(data.results || [])
      setSearchInfo({ method: data.method, total: data.total })
    } catch (error) {
      console.error('Search failed:', error)
      setSearchInfo(null)
    } finally {
      setIsSearching(false)
    }
  }

  const toggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark')
  }

  const renderPrompt = (prompt: Prompt) => (
    <div key={prompt.id} className="content-item prompt">
      <div className="content-item-header">
        <span className="badge badge-prompt">Prompt</span>
        <span className="content-meta-item">{formatDate(prompt.timestamp)}</span>
      </div>
      <div className="content-text">{prompt.content}</div>
      <div className="content-meta">
        <span className="content-meta-item">Session: {prompt.session_id.substring(0, 8)}...</span>
      </div>
    </div>
  )

  const renderObservation = (obs: Observation) => {
    const content = obs.tool_response || obs.tool_input
    const jsonResult = formatJsonWithHighlight(content, 800)

    return (
      <div key={obs.id} className="content-item observation">
        <div className="content-item-header">
          <span className="badge badge-observation">{obs.tool_name}</span>
          {jsonResult.isJson && <span className="badge" style={{ background: '#f59e0b', marginLeft: '8px' }}>JSON</span>}
          <span className="content-meta-item">{formatDate(obs.timestamp)}</span>
        </div>
        {jsonResult.isJson ? (
          <pre
            className="content-text json-content"
            style={{ maxHeight: '300px', overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: jsonResult.html }}
          />
        ) : (
          <div className="content-text truncated">
            {truncateText(content, 300)}
          </div>
        )}
        <div className="content-meta">
          <span className="content-meta-item">Session: {obs.session_id.substring(0, 8)}...</span>
        </div>
      </div>
    )
  }

  const renderSession = (session: Session) => (
    <div key={session.id} className="content-item session">
      <div className="content-item-header">
        <span className="badge badge-session">Session</span>
        <span className={`badge ${session.status === 'active' ? 'badge-active' : 'badge-ended'}`}>
          {session.status === 'active' ? 'Active' : 'Ended'}
        </span>
      </div>
      <div className="session-path">{session.project_path}</div>
      <div className="content-meta">
        <span className="content-meta-item">ID: {session.session_id.substring(0, 12)}...</span>
        <span className="content-meta-item">Started: {formatDate(session.started_at)}</span>
        {session.ended_at && (
          <span className="content-meta-item">Ended: {formatDate(session.ended_at)}</span>
        )}
      </div>
    </div>
  )

  const renderSummary = (summary: Summary) => (
    <div key={summary.id} className="content-item session">
      <div className="content-item-header">
        <span className="badge badge-session">Summary</span>
        <span className="content-meta-item">{formatDate(summary.created_at)}</span>
        {summary.ai_summary && <span className="badge" style={{ background: '#10b981', marginLeft: '8px' }}>AI</span>}
      </div>
      {summary.ai_summary ? (
        <>
          <div className="content-text" style={{ marginBottom: '12px' }}>
            <strong style={{ color: '#10b981' }}>AI 요약:</strong>
            <div
              className="markdown-content"
              style={{ marginTop: '4px' }}
              dangerouslySetInnerHTML={{ __html: marked.parse(summary.ai_summary) as string }}
            />
          </div>
          <details style={{ marginBottom: '8px' }}>
            <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '0.875rem' }}>통계 정보 보기</summary>
            <div className="content-text" style={{ whiteSpace: 'pre-wrap', marginTop: '8px', padding: '8px', background: 'var(--bg-input)', borderRadius: '4px' }}>{summary.summary}</div>
          </details>
        </>
      ) : (
        <div className="content-text" style={{ whiteSpace: 'pre-wrap' }}>{summary.summary}</div>
      )}
      <div className="content-meta">
        <span className="content-meta-item">Session: {summary.session_id.substring(0, 8)}...</span>
        <span className="content-meta-item">Tokens: {summary.tokens}</span>
      </div>
    </div>
  )

  const renderResponse = (response: Response) => (
    <div key={response.id} className="content-item observation">
      <div className="content-item-header">
        <span className="badge badge-observation">Response</span>
        <span className="content-meta-item">{formatDate(response.timestamp)}</span>
      </div>
      <div
        className="content-text markdown-content"
        style={{ maxHeight: '400px', overflow: 'auto' }}
        dangerouslySetInnerHTML={{ __html: marked.parse(truncateText(response.content, 2000)) as string }}
      />
      <div className="content-meta">
        <span className="content-meta-item">Session: {response.session_id.substring(0, 8)}...</span>
        <span className="content-meta-item">Length: {response.content.length.toLocaleString()} chars</span>
      </div>
    </div>
  )

  const renderSearchResult = (result: SearchResult, index: number) => {
    const similarityPercent = Math.round(result.similarity * 100)
    const sourceColor = result.source === 'chroma' ? '#8b5cf6' : result.source === 'hybrid' ? '#10b981' : '#6b7280'
    const sourceLabel = result.source === 'chroma' ? 'Semantic' : result.source === 'hybrid' ? 'Hybrid' : 'Keyword'

    return (
      <div key={`search-${index}`} className="search-result-wrapper">
        <div className="search-result-meta" style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '8px',
          alignItems: 'center'
        }}>
          <span className="badge" style={{
            background: sourceColor,
            fontSize: '0.75rem',
            padding: '2px 8px'
          }}>
            {sourceLabel}
          </span>
          <span style={{
            color: similarityPercent >= 50 ? '#10b981' : '#f59e0b',
            fontSize: '0.875rem',
            fontWeight: 500
          }}>
            {similarityPercent}% match
          </span>
        </div>
        {result.type === 'prompt' && renderPrompt(result.data as Prompt)}
        {result.type === 'response' && renderResponse(result.data as Response)}
        {result.type === 'observation' && renderObservation(result.data as Observation)}
      </div>
    )
  }

  return (
    <>
      <header className="header">
        <div className="header-title">
          <DatabaseIcon />
          <span>jikime-mem</span>
        </div>
        <div className="header-actions">
          <button className="theme-toggle" onClick={toggleTheme} title="Toggle theme">
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
        </div>
      </header>

      <div className="container">
        {/* Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Sessions</span>
            </div>
            <div className="stat-card-value">{stats.sessions}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Prompts</span>
            </div>
            <div className="stat-card-value">{stats.prompts}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Observations</span>
            </div>
            <div className="stat-card-value">{stats.observations}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Responses</span>
            </div>
            <div className="stat-card-value">{stats.responses}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-header">
              <span className="stat-card-title">Summaries</span>
            </div>
            <div className="stat-card-value">{stats.summaries}</div>
          </div>
        </div>

        {/* Search */}
        <div className="search-section">
          <div className="search-title">
            <SearchIcon />
            <span>Search Memory</span>
          </div>
          <div className="search-form">
            <input
              type="text"
              className="search-input"
              placeholder="Search prompts, observations, and responses..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <select
              className="search-select"
              value={searchMethod}
              onChange={(e) => setSearchMethod(e.target.value as 'hybrid' | 'sqlite' | 'semantic')}
              style={{
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                fontSize: '0.875rem',
                cursor: 'pointer'
              }}
            >
              <option value="hybrid">Hybrid</option>
              <option value="semantic">Semantic</option>
              <option value="sqlite">Keyword</option>
            </select>
            <button
              className="search-button"
              onClick={handleSearch}
              disabled={isSearching}
            >
              {isSearching ? 'Searching...' : 'Search'}
            </button>
          </div>
          {searchInfo && (
            <div style={{
              marginTop: '8px',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              Found {searchInfo.total} results using <strong>{searchInfo.method}</strong> search
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'prompts' ? 'active' : ''}`}
            onClick={() => setActiveTab('prompts')}
          >
            Prompts ({stats.prompts})
          </button>
          <button
            className={`tab ${activeTab === 'observations' ? 'active' : ''}`}
            onClick={() => setActiveTab('observations')}
          >
            Observations ({stats.observations})
          </button>
          <button
            className={`tab ${activeTab === 'responses' ? 'active' : ''}`}
            onClick={() => setActiveTab('responses')}
          >
            Responses ({stats.responses})
          </button>
          <button
            className={`tab ${activeTab === 'summaries' ? 'active' : ''}`}
            onClick={() => setActiveTab('summaries')}
          >
            Summaries ({stats.summaries})
          </button>
          <button
            className={`tab ${activeTab === 'sessions' ? 'active' : ''}`}
            onClick={() => setActiveTab('sessions')}
          >
            Sessions ({stats.sessions})
          </button>
          {searchResults.length > 0 && (
            <button
              className={`tab ${activeTab === 'search' ? 'active' : ''}`}
              onClick={() => setActiveTab('search')}
            >
              Search Results ({searchResults.length})
            </button>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="loading">
            <div className="loading-spinner"></div>
            <p>Loading data...</p>
          </div>
        ) : (
          <div className="content-list">
            {activeTab === 'prompts' && (
              prompts.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📝</div>
                  <p>No prompts yet</p>
                </div>
              ) : (
                prompts.map(renderPrompt)
              )
            )}

            {activeTab === 'observations' && (
              observations.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔧</div>
                  <p>No observations yet</p>
                </div>
              ) : (
                observations.map(renderObservation)
              )
            )}

            {activeTab === 'responses' && (
              responses.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">💬</div>
                  <p>No responses yet</p>
                </div>
              ) : (
                responses.map(renderResponse)
              )
            )}

            {activeTab === 'summaries' && (
              summaries.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📋</div>
                  <p>No summaries yet</p>
                </div>
              ) : (
                summaries.map(renderSummary)
              )
            )}

            {activeTab === 'sessions' && (
              sessions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">📁</div>
                  <p>No sessions yet</p>
                </div>
              ) : (
                sessions.map(renderSession)
              )
            )}

            {activeTab === 'search' && (
              searchResults.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-icon">🔍</div>
                  <p>No search results</p>
                </div>
              ) : (
                searchResults.map(renderSearchResult)
              )
            )}
          </div>
        )}
      </div>
    </>
  )
}
