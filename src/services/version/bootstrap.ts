import { APP_VERSION } from '../../config/version'
import { resetCachesOnVersionChange } from './cacheReset'

resetCachesOnVersionChange(APP_VERSION)
