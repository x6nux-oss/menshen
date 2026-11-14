import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import type { State } from '../../api/types'
import { mockState } from '../../mocks/fixtures'
import { renderPage } from '../../test/renderPage'
import { ModelDetailView } from './ModelsView'

vi.mock('../../api/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../api/client')>()
  return { ...mod, api: vi.fn() }
})

const mockApi = vi.mocked(api)

function renderDetail(state: State) {
  mockApi.mockImplementation((async (op: string) => {
    if (op === 'state') return state
    return { ok: true }
  }) as never)
  return renderPage(<ModelDetailView name="demo/gpt-5-mini" />)
}

function modelBodies() {
  return mockApi.mock.calls
    .filter(([op]) => op === 'model')
    .map(([, body]) => body)
}

beforeEach(() => {
  mockApi.mockReset()
})

describe('ModelDetailView 思考强度', () => {
  it('选择 high 提交 high', async () => {
    renderDetail(mockState)
    await screen.findByRole('heading', { name: 'demo/gpt-5-mini' })

    const effortSelect = screen.getByRole('combobox', { name: '思考强度' })
    expect(effortSelect).toHaveTextContent('不填')
    await userEvent.click(effortSelect)
    await userEvent.click(await screen.findByRole('option', { name: 'high' }))

    await waitFor(() => expect(modelBodies()).toHaveLength(1))
    expect(modelBodies()[0]).toEqual({
      action: 'update',
      name: 'demo/gpt-5-mini',
      reasoning_effort: 'high',
    })
  })

  it('选择不填提交空串', async () => {
    const stateWithHighEffort = structuredClone(mockState)
    stateWithHighEffort.models = (stateWithHighEffort.models ?? []).map((model) =>
      model.name === 'demo/gpt-5-mini' ? { ...model, reasoning_effort: 'high' } : model,
    )
    renderDetail(stateWithHighEffort)
    await screen.findByRole('heading', { name: 'demo/gpt-5-mini' })

    const effortSelect = screen.getByRole('combobox', { name: '思考强度' })
    expect(effortSelect).toHaveTextContent('high')
    await userEvent.click(effortSelect)
    await userEvent.click(await screen.findByRole('option', { name: '不填' }))

    await waitFor(() => expect(modelBodies()).toHaveLength(1))
    expect(modelBodies()[0]).toEqual({
      action: 'update',
      name: 'demo/gpt-5-mini',
      reasoning_effort: '',
    })
  })
})
