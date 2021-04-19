const cacheStore = {};

function setCache(key, data) {
  cacheStore[key] = { data, cacheTime: Date.now() };
}

function useCache(key, cacheFor, dataFunc, cacheHitFunc = (data) => data) {
  if (!cacheStore[key] || !cacheStore[key].cacheTime) {
    return dataFunc((data) => setCache(key, data));
  }
  const now = Date.now();

  if (now - cacheStore[key].cacheTime > cacheFor) {
    return dataFunc((data) => setCache(key, data));
  }

  return cacheHitFunc(cacheStore[key].data);
}

const requestStore = {};

function storeRequest(key, request) {
  requestStore[key] = request;
}
function clearRequest(key, request) {
  Reflect.deleteProperty(requestStore, key);
}
function getRequestFromStore(key) {
  return requestStore[key];
}

function getRequestKey(url, { key }) {
  return key || url;
}

function getQueryString(query) {
  const queries = Object.keys(query).map((key) => (
    `${key}=${encodeURIComponent(query[key])}`
  ));

  return `?${queries.join('&')}`;
}

const debounceStore = {};
const debounceWaitStore = {};
function debounce(key, time = 0, func) {
  if (!time) {
    return func();
  }
  let timeoutFunc = setTimeout;
  if (debounceWaitStore[key] && Date.now() - debounceWaitStore[key] > time) {
    // fire debounced function if waiting for longer than debounce time
    debounceWaitStore[key] = null;
    timeoutFunc = (f) => f();
  } else if (!debounceWaitStore[key]) {
    debounceWaitStore[key] = Date.now();
  }


  clearTimeout(debounceStore[key]);
  return new Promise((resolve, reject) => {
    debounceStore[key] = timeoutFunc(() => {
      Reflect.deleteProperty(debounceStore, key);
      Reflect.deleteProperty(debounceWaitStore, key);
      resolve(func());
    }, time);
  });
}

// TODO add debounce
export default function fetchapi(url, options = { query: {} }) {
  const {
    body, // POST body object
    query, // search query object for GET vars
    headers,
    debounceFor = 0,
    cacheFor = 0,
    errorHandler = (status, json) => {
      throw new Error(`API Error ${status}`)
    }
  } = options;

  if (!url) {
    throw new Error('jsonApi requires a `url` option');
  }

  const requestKey = getRequestKey(url, options);
  const existingRequest = getRequestFromStore(requestKey);

  if (
    existingRequest &&
    query &&
    getQueryString(existingRequest.fetchOptions.query) !== getQueryString(query)
  ) {
    // new request to same key with different query
    // TODO cancel existing request
  } else if (existingRequest) {
    // existing request with same key, return that
    return existingRequest.request;
  }

  const method = options.method ? options.method.toUpperCase() : 'GET';

  const fetchOptions = Object.assign({}, options, {
    method,
    headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    body: body instanceof FormData ? body : JSON.stringify(body)
  });

  if (headers && headers['Content-Type'] === false) {
    // Set Content-Type header to false to allow the browser to set it
    // useful for posting files
    Reflect.deleteProperty(fetchOptions.headers, 'Content-Type');
  }

  if (method === 'GET' && query) {
    url += getQueryString(query);
  }

  function jsonFetch(cache) {
    const request = fetch(url, fetchOptions).
      then((response) => response.json().then((json) => {
        if (!response.ok) {
          errorHandler(response.status, json);
        }
        return json;
      })).
      then((json) => {
        clearRequest(requestKey, request);
        cache(json);
        return json;
      })
      .catch((err) => {
        clearRequest(requestKey, request);
        throw err;
      });

    storeRequest(requestKey, { request, fetchOptions });

    return request;
  }

  const requestFunc = (f) => debounce(requestKey, debounceFor, () => jsonFetch(f));

  if (cacheFor > 0) {
    return useCache(requestKey, cacheFor, requestFunc, (cache) => Promise.resolve(cache));
  }

  return requestFunc(Function.prototype);
}

export function customFetchapi(apiOptions) {
  return (url, options) => {
    return fetchapi(url, Object.assign({}, apiOptions, options));
  }
}