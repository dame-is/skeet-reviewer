// BlueskyPostManager.jsx

// Import necessary libraries
import './App.css';
import React, { useState, useEffect, useRef } from 'react';
import { AtpAgent } from '@atproto/api';

import 'bluesky-post-embed';
import 'bluesky-post-embed/style.css';
import 'bluesky-post-embed/themes/light.css';

import ErrorBoundary from './ErrorBoundary'; // Import the ErrorBoundary component

const version = 'v0.5.0'; // Updated version number for changes

const BlueskyPostManager = () => {
  const [posts, setPosts] = useState([]); 
  const [currentIndex, setCurrentIndex] = useState(0); 
  const [authenticated, setAuthenticated] = useState(false); 
  const [appPassword, setAppPassword] = useState(''); 
  const [handle, setHandle] = useState(''); 
  const [agent, setAgent] = useState(null); 
  const [accountDid, setAccountDid] = useState(null); 
  const [keptCount, setKeptCount] = useState(0); 
  const [deletedCount, setDeletedCount] = useState(0); 
  const [errorMessage, setErrorMessage] = useState(''); 
  const [postLoading, setPostLoading] = useState(false); 
  const [cursor, setCursor] = useState(null); 
  // Initialize filterReplies and filterReposts to true (checked by default)
  const [filterReplies, setFilterReplies] = useState(true); 
  const [filterReposts, setFilterReposts] = useState(true); 
  const [filterZeroLikes, setFilterZeroLikes] = useState(false); 
  const [randomizeOrder, setRandomizeOrder] = useState(false);
  const [forceFreshFetch, setForceFreshFetch] = useState(false); 

  const postRef = useRef(null);
  
  // Initialize a Set to track seen URIs
  const seenURIs = useRef(new Set());

  useEffect(() => {
    console.log("Initializing agent...");
    const newAgent = new AtpAgent({
      service: 'https://bsky.social',
      persistSession: (evt, sess) => {
        if (evt === 'create') {
          localStorage.setItem('blueskySession', JSON.stringify(sess));
        } else if (evt === 'destroy') {
          localStorage.removeItem('blueskySession');
        }
      },
    });

    const savedSession = localStorage.getItem('blueskySession');
    if (savedSession) {
      console.log("Found saved session, trying to resume...");
      newAgent
        .resumeSession(JSON.parse(savedSession))
        .then(() => {
          console.log("Session resumed successfully");
          setAuthenticated(true);
          setAccountDid(newAgent.session?.did);
        })
        .catch((error) => {
          console.error('Failed to resume session:', error);
        });
    }

    setAgent(newAgent);
  }, []);

  const handleLogin = async () => {
    if (!agent) {
      console.error('Agent not initialized');
      alert('Internal error: Agent not initialized');
      return;
    }

    if (!handle || !appPassword) {
      alert('Please enter both your handle and app password.');
      return;
    }

    try {
      console.log('Attempting login with:', { handle, appPassword });
      await agent.login({
        identifier: handle.trim(),
        password: appPassword.trim(),
      });

      setAuthenticated(true);
      setAccountDid(agent.session?.did);
      console.log('Login successful! DID:', agent.session?.did);
    } catch (error) {
      console.error('Error during login:', error);
      alert('Login failed. Check your credentials.');
    }
  };

  const fetchPosts = async (cursorParam = null, retries = 3) => {
    if (!agent || !accountDid) {
      console.log("fetchPosts called without proper agent/accountDid");
      return;
    }

    console.log('Fetching posts...', { accountDid, cursor: cursorParam });
    try {
      const response = await agent.getAuthorFeed({
        actor: accountDid,
        limit: 50,
        cursor: cursorParam || undefined,
      });

      console.log('Fetch response:', response);

      if (!response || !response.data) {
        console.error('No data from API:', response);
        throw new Error('No data from API');
      }

      const fetchedPosts = response.data.feed.map((item) => {
        let type = 'Normal Post';
        const isReply = !!item.post.record?.reply;
        const isRepost = item.reason && item.reason.$type === 'app.bsky.feed.defs#reasonRepost';
        if (isRepost) {
          const originalAuthor = item.post.record?.author?.handle || 'unknown';
          type = `Repost of @${originalAuthor}`;
        } else if (isReply) {
          const replyTarget = item.post.record?.reply?.parent?.author?.handle || 'unknown';
          type = `Reply to @${replyTarget}`;
        }

        return {
          uri: item.post.uri,
          content: item.post.record?.text || 'No content available',
          createdAt: new Date(item.post.record?.createdAt).toLocaleString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          type,
          likes: item.post.metrics?.likes || 0,
          reposts: item.post.metrics?.reposts || 0,
          replies: item.post.metrics?.replies || 0,
          blueskyUrl: `https://bsky.app/profile/${item.post.author.did}/post/${item.post.uri.split('/').pop()}`,
        };
      });

      console.log("Fetched", fetchedPosts.length, "new posts.");
      console.log(fetchedPosts.map(p => p.uri));

      // Filter out posts that have already been seen
      const uniqueNewPosts = fetchedPosts.filter(post => {
        if (seenURIs.current.has(post.uri)) {
          return false;
        }
        return true;
      });

      console.log("Unique new posts after filtering:", uniqueNewPosts.length);

      // Add the URIs of the unique new posts to the seenURIs set
      uniqueNewPosts.forEach(post => seenURIs.current.add(post.uri));

      let newPosts;
      if (forceFreshFetch || (!cursorParam && posts.length === 0)) {
        newPosts = uniqueNewPosts;
      } else {
        newPosts = [...posts, ...uniqueNewPosts];
      }

      if (randomizeOrder) {
        console.log("Randomizing order");
        newPosts = shuffleArray(newPosts);
      }

      console.log("Total posts after fetch:", newPosts.length);

      setPosts(newPosts);

      if (response.data.cursor) {
        console.log("Setting new cursor:", response.data.cursor);
        setCursor(response.data.cursor);
      } else {
        console.log("No more cursor returned.");
        setCursor(null);
      }

      if (forceFreshFetch) {
        console.log("Disabling forceFreshFetch");
        setForceFreshFetch(false);
      }

      if (newPosts.length > 0 && posts.length === 0 && !cursorParam) {
        console.log("Got first batch of posts, setting postLoading = true");
        setPostLoading(true);
      } else if (newPosts.length === 0) {
        console.log("No posts found, setting postLoading = false");
        setPostLoading(false);
      }

    } catch (error) {
      console.error('Error fetching posts:', error);
      if (retries > 0) {
        console.log(`Retrying fetchPosts... Attempts left: ${retries}`);
        setTimeout(() => {
          fetchPosts(cursorParam, retries - 1);
        }, 2000); // Retry after 2 seconds
      } else {
        setErrorMessage('Failed to fetch posts after multiple attempts. Please check your network connection or try again later.');
        setPostLoading(false);
      }
    }
  };

  const shuffleArray = (array) => {
    console.log("Shuffling posts...");
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  useEffect(() => {
    console.log("Check initial fetch conditions:", { authenticated, agent: !!agent, accountDid, postsLength: posts.length, forceFreshFetch });
    if (authenticated && agent && accountDid && posts.length === 0 && !forceFreshFetch) {
      console.log("Triggering initial fetch");
      fetchPosts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, agent, accountDid]);

  useEffect(() => {
    console.log("CurrentIndex changed:", currentIndex, "posts.length:", posts.length, "cursor:", cursor);
    if (posts[currentIndex]?.uri) {
      console.log("Current post available, set postLoading = true to wait for embed to load");
      setPostLoading(true);
    }

    const postsLeft = posts.length - currentIndex - 1;
    if (postsLeft < 5 && cursor && !forceFreshFetch) {
      console.log("Less than 5 posts left, fetching more...");
      fetchPosts(cursor);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, posts, cursor]);

  useEffect(() => {
    if (forceFreshFetch && authenticated && agent && accountDid) {
      console.log("Forcing fresh fetch...");
      setPosts([]);
      setCursor(null);
      setCurrentIndex(0);
      seenURIs.current.clear(); // Clear the seenURIs set when forcing a fresh fetch
      fetchPosts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceFreshFetch, authenticated, agent, accountDid]);

  useEffect(() => {
    if (!postRef.current) {
      console.log("postRef not yet attached");
      return;
    }

    const handleLoaded = () => {
      console.log('Embed loaded event fired, setting postLoading = false');
      setPostLoading(false);
    };

    const handleErrorEvent = () => {
      console.error('Embed error event fired, setting postLoading = false');
      setPostLoading(false);
    };

    const el = postRef.current;
    el.addEventListener('loaded', handleLoaded);
    el.addEventListener('error', handleErrorEvent);

    return () => {
      el.removeEventListener('loaded', handleLoaded);
      el.removeEventListener('error', handleErrorEvent);
    };
  }, [posts, currentIndex]);

  const isReplyPost = (post) => post && post.type && post.type.startsWith('Reply to ');
  const isRepostPost = (post) => post && post.type && post.type.startsWith('Repost of ');
  const hasZeroLikes = (post) => post && post.likes === 0;

  // Modify the filter logic to skip posts only when filters are **unchecked**
  const advanceToNextValidPost = (startIndex) => {
    let idx = startIndex;
    while (
      idx < posts.length && (
        (!filterReplies && isReplyPost(posts[idx])) ||
        (!filterReposts && isRepostPost(posts[idx])) ||
        (filterZeroLikes && !hasZeroLikes(posts[idx]))
      )
    ) {
      idx++;
    }
    console.log("advanceToNextValidPost from", startIndex, "to", idx);
    return idx;
  };

  const handleKeep = () => {
    console.log("Keep clicked");
    setPostLoading(true); 
    const nextIndex = advanceToNextValidPost(currentIndex + 1);
    if (nextIndex >= posts.length) {
      setPostLoading(false);
    }
    setCurrentIndex(nextIndex);
    setKeptCount((prev) => prev + 1);
  };
  
  const handleDelete = async () => {
    console.log("Delete clicked");
    const postToDelete = posts[currentIndex];
    if (!agent) {
      console.error('Agent not initialized');
      return;
    }
  
    try {
      setPostLoading(true); 
      await agent.deletePost(postToDelete.uri);
      
      const updatedPosts = [...posts];
      updatedPosts.splice(currentIndex, 1);
      setPosts(updatedPosts);

      // Do NOT remove the URI from seenURIs to prevent duplicates
      // seenURIs.current.delete(postToDelete.uri);
      
      if (updatedPosts.length === 0) {
        setPostLoading(false);
        return;
      }

      let nextIndex = currentIndex;
      if (nextIndex >= updatedPosts.length) {
        nextIndex = updatedPosts.length; 
      } else {
        nextIndex = advanceToNextValidPost(nextIndex);
      }

      if (nextIndex >= updatedPosts.length) {
        setPostLoading(false);
      }
      setCurrentIndex(nextIndex);
      setDeletedCount((prev) => prev + 1);

    } catch (error) {
      console.error('Error deleting post:', error);
      setPostLoading(false);
    }
  };

  // Adjust the filter handlers to reflect the new default checked state
  const handleFilterRepliesChange = (e) => {
    console.log("Replies filter:", e.target.checked);
    const newFilter = e.target.checked;
    setFilterReplies(newFilter);
    if (!newFilter && posts[currentIndex] && isReplyPost(posts[currentIndex])) { // Effect occurs when unchecked
      const nextIndex = advanceToNextValidPost(currentIndex + 1);
      if (nextIndex >= posts.length) setPostLoading(false);
      setCurrentIndex(nextIndex);
    }
  };

  const handleFilterRepostsChange = (e) => {
    console.log("Reposts filter:", e.target.checked);
    const newFilter = e.target.checked;
    setFilterReposts(newFilter);
    if (!newFilter && posts[currentIndex] && isRepostPost(posts[currentIndex])) { // Effect occurs when unchecked
      const nextIndex = advanceToNextValidPost(currentIndex + 1);
      if (nextIndex >= posts.length) setPostLoading(false);
      setCurrentIndex(nextIndex);
    }
  };

  const handleFilterZeroLikesChange = (e) => {
    console.log("0 Likes filter:", e.target.checked);
    const newFilter = e.target.checked;
    setFilterZeroLikes(newFilter);
    if (newFilter && posts[currentIndex] && !hasZeroLikes(posts[currentIndex])) {
      const nextIndex = advanceToNextValidPost(currentIndex + 1);
      if (nextIndex >= posts.length) setPostLoading(false);
      setCurrentIndex(nextIndex);
    }
  };

  const handleRandomizeChange = (e) => {
    console.log("Randomize changed:", e.target.checked);
    const newState = e.target.checked;
    if (newState) {
      setRandomizeOrder(true);
      if (posts.length > 0) {
        const shuffled = shuffleArray(posts);
        setPosts(shuffled);
        setCurrentIndex(0);
      }
    } else {
      setRandomizeOrder(false);
      setForceFreshFetch(true);
    }
  };

  const handleLogout = () => {
    console.log("Logout clicked");
    localStorage.removeItem('blueskySession');
    setAuthenticated(false);
    setAgent(null);
    setHandle('');
    setAppPassword('');
    setPosts([]);
    setCurrentIndex(0);
    setKeptCount(0);
    setDeletedCount(0);
    setAccountDid(null);
    setErrorMessage('');
    setCursor(null);
    setFilterReplies(true); // Reset to default (checked)
    setFilterReposts(true); // Reset to default (checked)
    setFilterZeroLikes(false);
    setRandomizeOrder(false);
    setForceFreshFetch(false);
    seenURIs.current.clear(); // Clear seen URIs on logout
  };

  console.log("Render: authenticated =", authenticated, "currentIndex =", currentIndex, "posts.length =", posts.length, "postLoading =", postLoading);
  const currentPost = posts[currentIndex];
  if (currentPost) {
    console.log("Current post URI:", currentPost.uri);
  }

  if (!authenticated) {
    return (
      <div className="login-container">
        <div className="login-header">
          <h1 className="login-title">Skeet Reviewer</h1>
          {/* Descriptive Text */}
          <p className="login-description">
            A tool that helps you sort through your post archive to delete unwanted skeets.
          </p>
        </div>

        <div className="login-form">
          <h2 className="login-subtitle">Login to Bluesky</h2>

          <div className="form-group">
            <label htmlFor="handle" className="form-label">Bluesky Handle</label>
            <input
              type="text"
              id="handle"
              className="form-input"
              placeholder="user.bsky.social"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="appPassword" className="form-label">App Password</label>
            <input
              type="password"
              id="appPassword"
              className="form-input"
              placeholder="keod-iadh-kbrx-pafw"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
            />
          </div>

          <div className="form-links">
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noopener noreferrer"
              className="form-link"
            >
              Need an app password? Go here.
            </a>
          </div>

          <button className="login-button" onClick={handleLogin}>Login</button>

          {/* Credit Link */}
          <div className="credit-link">
            <a
              href="https://bsky.app/profile/dame.bsky.social"
              target="_blank"
              rel="noopener noreferrer"
              className="credit-link-anchor"
            >
              Made by @dame.bsky.social
            </a>
          </div>

          {/* Github Link */}
          <div className="github-link">
            <a
              href="https://github.com/damedotblog/skeet-reviewer"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link-anchor"
            >
              View code on Github
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (currentIndex >= posts.length && !cursor && !forceFreshFetch) {
    return (
      <div className="all-reviewed-container">
        {errorMessage ? <p className="error-message">{errorMessage}</p> : <div className="all-reviewed-message">All posts reviewed!</div>}
        <button className="logout-button" onClick={handleLogout}>Log Out</button>
      </div>
    );
  }

  return (
    <>
      {/* Header */}
      <div className="review-header">
        <h1>Skeet Reviewer</h1>
      </div>

      {/* Post Content */}
      <div className="post-content">
        <div className="prompt">
          <h2>Does this skeet still spark joy?</h2>
        </div>

        {postLoading && (
          <div className="skeleton-container">
            <div className="skeleton-line title"></div>
            <div className="skeleton-line body"></div>
            <div className="skeleton-line body"></div>
          </div>
        )}

        {/* Use ErrorBoundary to catch errors in bluesky-post */}
        <ErrorBoundary>
          {currentPost && currentPost.uri && currentPost.uri.startsWith('at://') && (
            <bluesky-post
              key={currentPost.uri}
              src={currentPost.uri}
              service-uri="https://public.api.bsky.app"
              allow-unauthenticated
              contextless
              ref={postRef}
            ></bluesky-post>
          )}
        </ErrorBoundary>

        {!postLoading && posts.length === 0 && (
          <p>No posts available.</p>
        )}

        {/* Invisible Spacer Element */}
        <div className="spacer"></div>
      </div>

      {/* Footer */}
      <div className="bottom-stuff">
        <div className="filters-row">
          <label className="filter-label">
            <input
              type="checkbox"
              checked={filterReplies}
              onChange={handleFilterRepliesChange}
              className="filter-checkbox"
            />
            Replies
          </label>
          <label className="filter-label">
            <input
              type="checkbox"
              checked={filterReposts}
              onChange={handleFilterRepostsChange}
              className="filter-checkbox"
            />
            Reposts
          </label>
          {/*<label className="filter-label">
            <input
              type="checkbox"
              checked={filterZeroLikes}
              onChange={handleFilterZeroLikesChange}
              className="filter-checkbox"
            />
            0 Likes
          </label>*/}
          <label className="filter-label">
            <input
              type="checkbox"
              checked={randomizeOrder}
              onChange={handleRandomizeChange}
              className="filter-checkbox"
            />
            Randomize
          </label>
        </div>

        <div className="actions">
          <button className="action-button keep-button" onClick={handleKeep}>Keep</button>
          <button className="action-button delete-button" onClick={handleDelete}>Delete</button>
        </div>
        <div className="counters">
          <p>Kept: {keptCount} | Deleted: {deletedCount}</p>
        </div>
        <button className="logout-button" onClick={handleLogout}>
          Log Out
        </button>
        
        {/* Credit Link in Footer */}
        <div className="credit-link">
          <a
            href="https://bsky.app/profile/dame.bsky.social"
            target="_blank"
            rel="noopener noreferrer"
            className="credit-link-anchor"
          >
            Made by @dame.bsky.social
          </a>
        </div>

          {/* Github Link */}
          <div className="github-link">
            <a
              href="https://github.com/damedotblog/skeet-reviewer"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link-anchor"
            >
              View code on Github
            </a>
          </div>
        
        <div className="version-info">
          {version}
        </div>
      </div>
    </>
  );  
};

export default BlueskyPostManager;
