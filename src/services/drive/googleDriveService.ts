const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD_BASE = 'https://www.googleapis.com/upload/drive/v3'

export class DriveApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DriveApiError'
    this.status = status
  }
}

export type DriveFileInfo = {
  id: string
  name: string
  modifiedTime?: string
  appProperties?: Record<string, string>
}

type DriveListResponse = {
  files: DriveFileInfo[]
}

export async function ensureDriveFolder(
  accessToken: string,
  folderName: string,
): Promise<DriveFileInfo> {
  const query = [
    `name = '${folderName.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
  ].join(' and ')

  const listUrl = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)`
  const listResponse = await driveFetchJson<DriveListResponse>(listUrl, accessToken)
  const existing = listResponse.files?.[0]

  if (existing) {
    return existing
  }

  const createUrl = `${DRIVE_API_BASE}/files?fields=id,name,modifiedTime`
  const created = await driveFetchJson<DriveFileInfo>(createUrl, accessToken, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
    }),
  })

  return created
}

export async function listDriveFiles(
  accessToken: string,
  folderId: string,
): Promise<DriveFileInfo[]> {
  const query = [`'${folderId}' in parents`, 'trashed = false'].join(' and ')
  const url = `${DRIVE_API_BASE}/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,appProperties)`
  const response = await driveFetchJson<DriveListResponse>(url, accessToken)
  return response.files ?? []
}

export async function downloadDriveFile<T>(
  accessToken: string,
  fileId: string,
): Promise<T> {
  const url = `${DRIVE_API_BASE}/files/${fileId}?alt=media`
  const response = await driveFetch(url, accessToken)
  return response.json() as Promise<T>
}

export async function createDriveFile(
  accessToken: string,
  options: {
    folderId: string
    name: string
    appProperties?: Record<string, string>
    payload: unknown
  },
): Promise<DriveFileInfo> {
  const formData = new FormData()
  formData.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: options.name,
          parents: [options.folderId],
          appProperties: options.appProperties,
        }),
      ],
      { type: 'application/json' },
    ),
  )
  formData.append(
    'file',
    new Blob([JSON.stringify(options.payload)], { type: 'application/json' }),
  )

  const url = `${DRIVE_UPLOAD_BASE}/files?uploadType=multipart&fields=id,name,modifiedTime,appProperties`
  return driveFetchJson<DriveFileInfo>(url, accessToken, {
    method: 'POST',
    body: formData,
  })
}

export async function updateDriveFile(
  accessToken: string,
  options: {
    fileId: string
    name: string
    appProperties?: Record<string, string>
    payload: unknown
  },
): Promise<DriveFileInfo> {
  const formData = new FormData()
  formData.append(
    'metadata',
    new Blob(
      [
        JSON.stringify({
          name: options.name,
          appProperties: options.appProperties,
        }),
      ],
      { type: 'application/json' },
    ),
  )
  formData.append(
    'file',
    new Blob([JSON.stringify(options.payload)], { type: 'application/json' }),
  )

  const url = `${DRIVE_UPLOAD_BASE}/files/${options.fileId}?uploadType=multipart&fields=id,name,modifiedTime,appProperties`
  return driveFetchJson<DriveFileInfo>(url, accessToken, {
    method: 'PATCH',
    body: formData,
  })
}

async function driveFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new DriveApiError(response.status, `Drive request failed (${response.status}): ${text}`)
  }

  return response
}

async function driveFetchJson<T>(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await driveFetch(url, accessToken, init)
  return (await response.json()) as T
}
