import React, { createContext, useState, useContext, useEffect } from "react";
import * as qss from "qss";

import { createHistory, createMemorySource } from "./history";
import {
  isModifiedEvent,
  resolve,
  isMatch,
  startsWith,
  getResolvedBasepath
} from "./utils";

// Allow creation of custom historys including memory sources
export { createHistory, createMemorySource };

// The shared context for everything
const context = createContext();

// Detect if we're in the DOM
const isDOM = Boolean(window.document && window.document.createElement);

// This is the default history object if none is defined
export const globalHistory = createHistory(
  isDOM ? window : createMemorySource()
);

// This is the main Location component that acts like a Provider
export const Location = ({
  history: userHistory,
  basepath: userBasepath,
  children
}) => {
  // If this is the first history, create it using the userHistory or browserHistory
  const [history] = useState(userHistory || globalHistory);

  // Let's get at some of the nested data on the history object
  const {
    location: { pathname, hash: fullHash, search: searchStr, state },
    _onTransitionComplete
  } = history;

  // Get the hash without the bang
  const hash = fullHash.split("#").reverse()[0];
  // The default basepath for the entire Location
  const basepath = userBasepath || "/";
  // Parse the query params into an object
  const query = qss.decode(searchStr.substring(1));

  // Try to parse any query params that might be json
  Object.keys(query).forEach(key => {
    try {
      query[key] = JSON.parse(query[key]);
    } catch (err) {
      //
    }
  });

  // Start off with fresh params at the top level
  const params = {};
  const href = pathname + (hash ? "#" + hash : "") + searchStr;

  // Build our context value
  const contextValue = {
    basepath,
    pathname,
    hash,
    params,
    query,
    searchStr,
    state,
    href,
    history
  };

  // Force the component to rerender when the history changes
  const [_, setCount] = useState(0);
  useEffect(() => {
    const unlisten = history.listen(() => setCount(old => old + 1));
    return () => {
      unlisten();
    };
  }, []);

  // After component update, mark the transition as complete
  useEffect(() => {
    _onTransitionComplete();
  });

  // Provide the context
  return <context.Provider value={contextValue}>{children}</context.Provider>;
};

// This hook powers just about everything. It is also responsible for
// creating the navigate() function based on the depth at which the hook is used
export const useLocation = () => {
  const contextValue = useContext(context);
  const { query, state, history, basepath } = contextValue;

  // Make the navigate function
  const navigate = (
    to,
    { query: queryUpdater, state: stateUpdater, replace, preview }
  ) => {
    // Allow query params and state to be updated with a function
    const resolvedQuery =
      typeof queryUpdater === "function" ? queryUpdater(query) : queryUpdater;
    const resolvedState =
      typeof stateUpdater === "function" ? stateUpdater(state) : stateUpdater;

    // If the query was updated, serialize all of the subkeys
    if (resolvedQuery) {
      Object.keys(resolvedQuery).forEach(key => {
        const val = resolvedQuery[key];
        if (typeof val === "object" && val !== "null") {
          resolvedQuery[key] = JSON.stringify(val);
        }
      });
    }

    // Then stringify the query params for URL encoding
    const searchStr = qss.encode(resolvedQuery, "?");

    // Construct the final href for the navigation
    const href = resolve(to, basepath) + (searchStr === "?" ? "" : searchStr);

    // If this is a preview, just return the final href
    if (preview) {
      return href;
    }

    // Otherwise, apply the navigation to the history
    return history._navigate(href, {
      state: resolvedState,
      replace
    });
  };

  return {
    ...contextValue,
    navigate // add the navigat function to the hook output
  };
};

// MatchFirst returns the first matching child Match component or
// any non-null non-Match component and renders only that component.
// Comparable to React-Locations Swtich component
export const MatchFirst = ({ children }) => {
  const locationValue = useLocation();
  const { basepath, pathname } = locationValue;

  let match;
  // Loop over all of the children
  React.Children.forEach(children, child => {
    // If the match hasn't been found yet and the child is valid
    if (!match && React.isValidElement(child)) {
      // If the child isn't a route, it's the default content
      // and becomes the only match
      if (child.type !== Match) {
        match = child;
        return;
      }

      // It must be a Match component, then.
      // Try and match on its to/from prop
      const path = child.props.path || child.props.from;
      let newBasepath = getResolvedBasepath(path, basepath);
      const matched = isMatch(newBasepath, pathname);

      // If it's a match
      if (matched) {
        // If it's an index path
        if (path === "/") {
          // And if the match is exact
          if (matched.isExact) {
            // Return this child
            match = child;
          }
          // Don't return non-exact index matches
          return;
        }
        // Return all other general matches though
        match = child;
        return;
      }
    }
  });

  // Return the match or null
  return match || null;
};

// The Match component is used to match paths againts the location and
// render content for that match
export const Match = ({ path, children, render, component: Comp }) => {
  // Use the location
  const locationValue = useLocation();
  const { basepath, pathname, params } = locationValue;

  // Resolve the new basepath from the Match's path prop
  let newBasePath = getResolvedBasepath(path, basepath);
  // See if the route is currently matched
  const match = isMatch(newBasePath, pathname);

  if (match) {
    // If the route is a match, make sure we use
    // the newBasePath from the match. It contains
    // the interpolated path, free of route param
    // identifiers
    newBasePath = match.newBasePath;
  }

  // Update the contex to use hte new basePath and params
  const contextValue = {
    ...locationValue,
    basepath: newBasePath,
    params: {
      ...params,
      ...(match ? match.params : {})
    }
  };

  // Not a match? Return null
  if (!match) {
    return null;
  }

  // Support the render prop
  if (render) {
    children = render(contextValue);
  }

  // Support the component prop
  if (Comp) {
    children = <Comp {...contextValue} />;
  }

  // Support child as a function
  if (typeof children === "function") {
    children = children(contextValue);
  }

  // Support just children
  return <context.Provider value={contextValue}>{children}</context.Provider>;
};

// The Match component is used to match paths againts the location and
// render content for that match
export const Redirect = ({ from, to, query, state, replace }) => {
  // Use the location
  const locationValue = useLocation();
  const { basepath, pathname, navigate } = locationValue;

  // Resolve the new basepath from the Match's path prop
  let newBasePath = getResolvedBasepath(from, basepath);
  // See if the route is currently matched
  const match = isMatch(newBasePath, pathname);

  if (match) {
    navigate(to, { query, state, replace });
  }

  return null;
};

export function Link({
  to,
  query,
  replace,
  state,
  onClick,
  target,
  style = {},
  className = "",
  getActiveProps = () => ({}),
  activeType,
  children,
  ...rest
}) {
  // Use the useLocation hook
  const location = useLocation();
  const { navigate, pathname, href } = location;

  // If this `to` is an external URL, make a normal a href
  try {
    const link = new URL(to);
    return (
      <a
        href={link.href}
        target={target}
        style={style}
        className={className}
        {...rest}
      >
        {children}
      </a>
    );
  } catch (e) {
    // if a path is not parsable by URL its a local relative path.
    // Proceed
  }

  // Get the preview href for this link and its variations
  const linkHrefWithQuery = navigate(to, {
    query,
    state,
    replace,
    preview: true
  });
  const linkHrefWithHash = linkHrefWithQuery.split("?")[0];
  const linkHref = linkHrefWithHash.split("#")[0];

  // Detect if this link is active using the different activeType options
  let isCurrent;
  if (activeType === "partial") {
    isCurrent = startsWith(href, linkHrefWithQuery);
  } else if (activeType === "path") {
    isCurrent = pathname === linkHref;
  } else if (activeType === "hash") {
    isCurrent = pathname === linkHrefWithHash;
  } else {
    isCurrent = href === linkHrefWithQuery;
  }

  // Get the active props
  const {
    style: activeStyle = {},
    className: activeClassName = "",
    ...activeRest
  } = isCurrent ? getActiveProps(location) : {};

  // The click handler
  const handleClick = e => {
    if (onClick) onClick(e);

    if (
      !e.defaultPrevented && // onClick prevented default
      e.button === 0 && // ignore everything but left clicks
      (!target || target === "_self") && // let browser handle "target=_blank" etc.
      !isModifiedEvent(e) // ignore clicks with modifier keys
    ) {
      e.preventDefault();
      // All is well? Navigate!
      navigate(to, { query, state, replace });
    }
  };

  return (
    <a
      href={linkHrefWithQuery}
      target={target}
      onClick={handleClick}
      style={{
        ...style,
        ...activeStyle
      }}
      className={
        [className, activeClassName].filter(Boolean).join(" ") || undefined
      }
      {...rest}
      {...activeRest}
    >
      {children}
    </a>
  );
}
