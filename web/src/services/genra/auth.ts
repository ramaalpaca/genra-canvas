// Genra login state: supabase-js session shared with genra.ai / editor.genra.ai via a `.genra.ai` cookie.
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { create } from "zustand";

import { cookieStorage } from "./cookie-storage";
import { GENRA_FRONTEND_URL, GENRA_SUPABASE_ANON_KEY, GENRA_SUPABASE_URL } from "./env";

export const supabase = createClient(GENRA_SUPABASE_URL, GENRA_SUPABASE_ANON_KEY, {
    auth: {
        storage: cookieStorage,
        persistSession: true,
        autoRefreshToken: true,
        // PKCE: same as editor_web; OAuth callbacks arrive as ?code= and are exchanged inside supabase-js.
        flowType: "pkce",
        detectSessionInUrl: true,
    },
});

type GenraAuthState = {
    /** undefined = not checked yet, null = signed out */
    session: Session | null | undefined;
    user: User | null;
};

export const useGenraAuth = create<GenraAuthState>()(() => ({ session: undefined, user: null }));

export function getGenraAccessToken() {
    return useGenraAuth.getState().session?.access_token || "";
}

/** Send the browser to the Genra login page. The main site shares the session cookie back on `.genra.ai`. */
export function redirectToGenraLogin() {
    // TODO(video_mvp): main site /login ignores `redirect` today and lands on the editor after sign-in;
    // honor it there so users come straight back to the canvas.
    const redirect = encodeURIComponent(window.location.href);
    window.location.replace(`${GENRA_FRONTEND_URL}/login?redirect=${redirect}`);
}

export async function signOutGenra() {
    await supabase.auth.signOut();
    redirectToGenraLogin();
}

/**
 * Resolve the current session once and keep the store in sync with supabase-js auth events.
 * `onSession` fires for the initial session and every token refresh (new JWT).
 */
export function watchGenraSession(onSession: (session: Session) => void) {
    const apply = (session: Session | null) => {
        useGenraAuth.setState({ session, user: session?.user || null });
        if (session) onSession(session);
    };

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT") {
            apply(null);
            redirectToGenraLogin();
            return;
        }
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") apply(session);
    });

    void supabase.auth.getSession().then(({ data: { session } }) => {
        if (!session) {
            apply(null);
            redirectToGenraLogin();
        }
    });

    return () => data.subscription.unsubscribe();
}
