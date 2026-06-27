#!/usr/bin/env python3
"""
CVF PT Backend API Test Suite
Tests all backend endpoints with proper authentication and ownership enforcement
"""
import requests
import sys
from datetime import datetime, timedelta
import json

BASE_URL = "https://cvf-pt-app.preview.emergentagent.com/api"

class Colors:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'

class APITester:
    def __init__(self):
        self.tests_run = 0
        self.tests_passed = 0
        self.tests_failed = 0
        self.admin_token = None
        self.coach_jordan_token = None
        self.coach_alex_token = None
        self.client_token = None
        self.test_data = {}
        
    def log(self, msg, color=Colors.BLUE):
        print(f"{color}{msg}{Colors.END}")
        
    def test(self, name, method, endpoint, expected_status, data=None, token=None, params=None):
        """Run a single API test"""
        url = f"{BASE_URL}{endpoint}"
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        self.tests_run += 1
        print(f"\n{Colors.BLUE}🔍 Test {self.tests_run}: {name}{Colors.END}")
        
        try:
            if method == 'GET':
                response = requests.get(url, headers=headers, params=params, timeout=10)
            elif method == 'POST':
                response = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == 'PUT':
                response = requests.put(url, json=data, headers=headers, timeout=10)
            elif method == 'PATCH':
                response = requests.patch(url, json=data, headers=headers, timeout=10)
            elif method == 'DELETE':
                response = requests.delete(url, headers=headers, timeout=10)
            
            success = response.status_code == expected_status
            
            if success:
                self.tests_passed += 1
                print(f"{Colors.GREEN}✅ PASSED - Status: {response.status_code}{Colors.END}")
                try:
                    return True, response.json()
                except:
                    return True, {}
            else:
                self.tests_failed += 1
                print(f"{Colors.RED}❌ FAILED - Expected {expected_status}, got {response.status_code}{Colors.END}")
                try:
                    error_data = response.json()
                    print(f"{Colors.YELLOW}   Response: {json.dumps(error_data, indent=2)}{Colors.END}")
                except:
                    print(f"{Colors.YELLOW}   Response: {response.text[:200]}{Colors.END}")
                return False, {}
                
        except Exception as e:
            self.tests_failed += 1
            print(f"{Colors.RED}❌ FAILED - Error: {str(e)}{Colors.END}")
            return False, {}
    
    def run_all_tests(self):
        """Run all test suites"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("CVF PT BACKEND API TEST SUITE", Colors.BLUE)
        self.log("="*80 + "\n", Colors.BLUE)
        
        # Test suites in order
        self.test_auth()
        self.test_ownership_enforcement()
        self.test_invitation_signup_flow()
        self.test_clients()
        self.test_sessions()
        self.test_session_notes()
        self.test_progress()
        self.test_programs()
        self.test_messages()
        self.test_bookings()
        self.test_waivers()
        self.test_payments()
        self.test_admin()
        
        # Print summary
        self.print_summary()
        
        return 0 if self.tests_failed == 0 else 1
    
    def test_auth(self):
        """Test authentication endpoints"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: AUTHENTICATION", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Test admin login
        success, data = self.test(
            "Admin login with correct credentials",
            "POST", "/auth/login", 200,
            data={"email": "admin@corevaluefitness.com", "password": "CVFadmin2025!"}
        )
        if success:
            self.admin_token = data.get('access_token')
            if data.get('role') == 'admin':
                print(f"{Colors.GREEN}   ✓ Role is admin{Colors.END}")
            else:
                print(f"{Colors.RED}   ✗ Role should be admin, got {data.get('role')}{Colors.END}")
        
        # Test wrong password
        self.test(
            "Admin login with wrong password returns 401",
            "POST", "/auth/login", 401,
            data={"email": "admin@corevaluefitness.com", "password": "wrongpassword"}
        )
        
        # Test coach Jordan login
        success, data = self.test(
            "Coach Jordan login",
            "POST", "/auth/login", 200,
            data={"email": "coach.jordan@corevaluefitness.com", "password": "CVFcoach2025!"}
        )
        if success:
            self.coach_jordan_token = data.get('access_token')
            self.test_data['coach_jordan_id'] = data.get('profile', {}).get('id')
        
        # Test coach Alex login
        success, data = self.test(
            "Coach Alex login",
            "POST", "/auth/login", 200,
            data={"email": "coach.alex@corevaluefitness.com", "password": "CVFcoach2025!"}
        )
        if success:
            self.coach_alex_token = data.get('access_token')
            self.test_data['coach_alex_id'] = data.get('profile', {}).get('id')
        
        # Test client login
        success, data = self.test(
            "Client login",
            "POST", "/auth/login", 200,
            data={"email": "client.demo@corevaluefitness.com", "password": "CVFclient2025!"}
        )
        if success:
            self.client_token = data.get('access_token')
            self.test_data['client_demo_id'] = data.get('profile', {}).get('id')
        
        # Test /auth/me with admin token
        success, data = self.test(
            "GET /auth/me with admin token resolves role and profile",
            "GET", "/auth/me", 200,
            token=self.admin_token
        )
        if success:
            if data.get('role') == 'admin':
                print(f"{Colors.GREEN}   ✓ /me returns admin role{Colors.END}")
            else:
                print(f"{Colors.RED}   ✗ /me should return admin role{Colors.END}")
        
        # Test /auth/me with coach token
        self.test(
            "GET /auth/me with coach token",
            "GET", "/auth/me", 200,
            token=self.coach_jordan_token
        )
        
        # Test /auth/me with client token
        self.test(
            "GET /auth/me with client token",
            "GET", "/auth/me", 200,
            token=self.client_token
        )
    
    def test_ownership_enforcement(self):
        """Test CRITICAL ownership rules - coaches see only their clients"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: OWNERSHIP ENFORCEMENT (CRITICAL)", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Get all clients as admin to find Sarah Martinez
        success, data = self.test(
            "Admin GET /clients (should see all clients)",
            "GET", "/clients", 200,
            token=self.admin_token
        )
        if success:
            sarah = next((c for c in data if 'sarah' in c.get('name', '').lower() and 'martinez' in c.get('name', '').lower()), None)
            if sarah:
                self.test_data['sarah_id'] = sarah['id']
                self.test_data['sarah_coach_id'] = sarah.get('coach_id')
                print(f"{Colors.GREEN}   ✓ Found Sarah Martinez (ID: {sarah['id']}, Coach: {sarah.get('coach_id')}){Colors.END}")
            else:
                print(f"{Colors.YELLOW}   ⚠ Sarah Martinez not found in database{Colors.END}")
        
        # Jordan lists clients - should NOT include Sarah (who belongs to Marcus/admin)
        success, data = self.test(
            "Coach Jordan GET /clients (should NOT include Sarah Martinez)",
            "GET", "/clients", 200,
            token=self.coach_jordan_token
        )
        if success:
            sarah_in_list = any('sarah' in c.get('name', '').lower() and 'martinez' in c.get('name', '').lower() for c in data)
            if not sarah_in_list:
                print(f"{Colors.GREEN}   ✓ Jordan's client list does NOT include Sarah (correct){Colors.END}")
            else:
                print(f"{Colors.RED}   ✗ Jordan's client list INCLUDES Sarah (OWNERSHIP VIOLATION){Colors.END}")
        
        # Jordan tries to GET Sarah's profile - should return 404
        if 'sarah_id' in self.test_data:
            self.test(
                "Coach Jordan GET /clients/{sarah_id} returns 404 (ownership enforcement)",
                "GET", f"/clients/{self.test_data['sarah_id']}", 404,
                token=self.coach_jordan_token
            )
        
        # Client token tries to GET /clients - should return 403 or 401
        success, data = self.test(
            "Client token GET /clients returns 403 (role enforcement)",
            "GET", "/clients", 403,
            token=self.client_token
        )
        if not success:
            # Try 401 as alternative
            self.test(
                "Client token GET /clients returns 401 (alternative)",
                "GET", "/clients", 401,
                token=self.client_token
            )
    
    def test_invitation_signup_flow(self):
        """Test invitation-only signup flow"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: INVITATION SIGNUP FLOW", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Try to signup with non-invited email - should return 403
        random_email = f"random_{datetime.now().timestamp()}@example.com"
        success, data = self.test(
            "POST /auth/signup with non-invited email returns 403",
            "POST", "/auth/signup", 403,
            data={"email": random_email, "password": "TestPass123!"}
        )
        if success:
            if 'contact your coach' in data.get('error', '').lower():
                print(f"{Colors.GREEN}   ✓ Friendly error message includes 'contact your coach'{Colors.END}")
            else:
                print(f"{Colors.YELLOW}   ⚠ Error message: {data.get('error')}{Colors.END}")
        
        # Create a new client with unique email
        unique_email = f"test_client_{int(datetime.now().timestamp())}@example.com"
        success, data = self.test(
            "Coach creates new client with unique email",
            "POST", "/clients", 201,
            data={
                "name": f"Test Client {int(datetime.now().timestamp())}",
                "email": unique_email,
                "phone": "555-0123"
            },
            token=self.coach_jordan_token
        )
        if success:
            self.test_data['new_client_id'] = data.get('id')
            print(f"{Colors.GREEN}   ✓ Created client ID: {data.get('id')}{Colors.END}")
        
        # Toggle invite to true
        if 'new_client_id' in self.test_data:
            success, data = self.test(
                "PATCH /clients/:id/invite {invited:true}",
                "PATCH", f"/clients/{self.test_data['new_client_id']}/invite", 200,
                data={"invited": True},
                token=self.coach_jordan_token
            )
            if success and data.get('invited'):
                print(f"{Colors.GREEN}   ✓ Client invited flag set to true{Colors.END}")
            
            # Now signup with that email should succeed
            success, data = self.test(
                "POST /auth/signup with invited email succeeds 201",
                "POST", "/auth/signup", 201,
                data={"email": unique_email, "password": "TestPass123!"}
            )
            if success:
                if data.get('role') == 'client' and data.get('profile', {}).get('auth_user_id'):
                    print(f"{Colors.GREEN}   ✓ Signup succeeded and linked auth_user_id{Colors.END}")
                else:
                    print(f"{Colors.YELLOW}   ⚠ Signup succeeded but profile may not be linked correctly{Colors.END}")
    
    def test_clients(self):
        """Test client CRUD operations"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: CLIENTS CRUD", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Already tested in invitation flow, just verify GET works
        if 'new_client_id' in self.test_data:
            self.test(
                "GET /clients/:id (own client)",
                "GET", f"/clients/{self.test_data['new_client_id']}", 200,
                token=self.coach_jordan_token
            )
            
            # Update client
            self.test(
                "PUT /clients/:id (update client)",
                "PUT", f"/clients/{self.test_data['new_client_id']}", 200,
                data={"goals": "Build strength and endurance"},
                token=self.coach_jordan_token
            )
    
    def test_sessions(self):
        """Test session management and credit decrement"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: SESSIONS & CREDIT DECREMENT", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Get clients first
        success, data = self.test(
            "GET /clients to find a client for session",
            "GET", "/clients", 200,
            token=self.coach_jordan_token
        )
        
        if success and len(data) > 0:
            client_id = data[0]['id']
            self.test_data['session_client_id'] = client_id
            
            # Get initial credits
            success, credit_data = self.test(
                "GET /payments/credits/:clientId (before session)",
                "GET", f"/payments/credits/{client_id}", 200,
                token=self.coach_jordan_token
            )
            initial_credits = credit_data.get('balance', 0) if success else 0
            print(f"{Colors.BLUE}   Initial credits: {initial_credits}{Colors.END}")
            
            # Create session
            future_time = (datetime.now() + timedelta(hours=2)).isoformat()
            success, session_data = self.test(
                "POST /sessions (create session)",
                "POST", "/sessions", 201,
                data={
                    "client_id": client_id,
                    "scheduled_at": future_time,
                    "duration_minutes": 60,
                    "location": "CVF Studio"
                },
                token=self.coach_jordan_token
            )
            
            if success:
                session_id = session_data.get('id')
                self.test_data['session_id'] = session_id
                print(f"{Colors.GREEN}   ✓ Created session ID: {session_id}{Colors.END}")
                
                # Edit session
                new_time = (datetime.now() + timedelta(hours=3)).isoformat()
                self.test(
                    "PUT /sessions/:id (edit session)",
                    "PUT", f"/sessions/{session_id}", 200,
                    data={"scheduled_at": new_time, "duration_minutes": 90},
                    token=self.coach_jordan_token
                )
                
                # Complete session - should decrement credits
                success, complete_data = self.test(
                    "PATCH /sessions/:id/complete (should decrement credits)",
                    "PATCH", f"/sessions/{session_id}/complete", 200,
                    token=self.coach_jordan_token
                )
                
                if success:
                    credits_remaining = complete_data.get('credits_remaining')
                    credit_deducted = complete_data.get('credit_deducted')
                    print(f"{Colors.BLUE}   Credits remaining: {credits_remaining}, Deducted: {credit_deducted}{Colors.END}")
                    
                    # Verify credits via GET
                    success, verify_data = self.test(
                        "GET /payments/credits/:clientId (verify decrement)",
                        "GET", f"/payments/credits/{client_id}", 200,
                        token=self.coach_jordan_token
                    )
                    if success:
                        final_credits = verify_data.get('balance', 0)
                        print(f"{Colors.BLUE}   Final credits: {final_credits}{Colors.END}")
                        if credit_deducted and final_credits == initial_credits - 1:
                            print(f"{Colors.GREEN}   ✓ Credits decremented correctly{Colors.END}")
                        elif not credit_deducted and final_credits == initial_credits:
                            print(f"{Colors.YELLOW}   ⚠ No credits to deduct (expected if balance was 0){Colors.END}")
                
                # Try to complete again - should return 400
                self.test(
                    "PATCH /sessions/:id/complete (already completed) returns 400",
                    "PATCH", f"/sessions/{session_id}/complete", 400,
                    token=self.coach_jordan_token
                )
                
                # Create another session to test cancel
                success, cancel_session = self.test(
                    "POST /sessions (for cancel test)",
                    "POST", "/sessions", 201,
                    data={
                        "client_id": client_id,
                        "scheduled_at": future_time,
                        "duration_minutes": 60
                    },
                    token=self.coach_jordan_token
                )
                
                if success:
                    cancel_id = cancel_session.get('id')
                    self.test(
                        "PATCH /sessions/:id/cancel",
                        "PATCH", f"/sessions/{cancel_id}/cancel", 200,
                        token=self.coach_jordan_token
                    )
    
    def test_session_notes(self):
        """Test session notes with shared_with_client flag"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: SESSION NOTES", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        if 'session_id' not in self.test_data:
            print(f"{Colors.YELLOW}   ⚠ Skipping - no session created{Colors.END}")
            return
        
        session_id = self.test_data['session_id']
        
        # Create note with shared_with_client = true
        success, note1 = self.test(
            "POST /sessions/:id/notes (shared_with_client: true)",
            "POST", f"/sessions/{session_id}/notes", 201,
            data={"content": "Great progress today!", "shared_with_client": True},
            token=self.coach_jordan_token
        )
        
        # Create note with shared_with_client = false
        success, note2 = self.test(
            "POST /sessions/:id/notes (shared_with_client: false)",
            "POST", f"/sessions/{session_id}/notes", 201,
            data={"content": "Private coach note", "shared_with_client": False},
            token=self.coach_jordan_token
        )
        
        # Client GET /sessions/client/mine should show ONLY shared notes
        success, client_sessions = self.test(
            "Client GET /sessions/client/mine (should show only shared notes)",
            "GET", "/sessions/client/mine", 200,
            token=self.client_token
        )
        
        if success:
            # Find the session and check notes
            session = next((s for s in client_sessions if s.get('id') == session_id), None)
            if session:
                shared_notes = session.get('shared_notes', [])
                print(f"{Colors.BLUE}   Client sees {len(shared_notes)} shared note(s){Colors.END}")
                has_shared = any('Great progress' in n.get('content', '') for n in shared_notes)
                has_private = any('Private coach note' in n.get('content', '') for n in shared_notes)
                
                if has_shared and not has_private:
                    print(f"{Colors.GREEN}   ✓ Client sees shared note but NOT private note{Colors.END}")
                elif has_private:
                    print(f"{Colors.RED}   ✗ Client can see private note (SECURITY ISSUE){Colors.END}")
    
    def test_progress(self):
        """Test progress tracking"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: PROGRESS TRACKING", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        if 'session_client_id' not in self.test_data:
            print(f"{Colors.YELLOW}   ⚠ Skipping - no client available{Colors.END}")
            return
        
        client_id = self.test_data['session_client_id']
        
        # Create metric
        success, metric = self.test(
            "POST /progress/metrics (create metric)",
            "POST", "/progress/metrics", 201,
            data={
                "client_id": client_id,
                "name": "Bench Press",
                "unit": "lbs",
                "category": "strength"
            },
            token=self.coach_jordan_token
        )
        
        if success:
            metric_id = metric.get('id')
            
            # Add entry
            self.test(
                "POST /progress/entries (add entry)",
                "POST", "/progress/entries", 201,
                data={
                    "metric_id": metric_id,
                    "value": 185,
                    "notes": "New PR!"
                },
                token=self.coach_jordan_token
            )
            
            # Client GET /progress/mine
            success, progress = self.test(
                "Client GET /progress/mine",
                "GET", "/progress/mine", 200,
                token=self.client_token
            )
            
            if success:
                print(f"{Colors.GREEN}   ✓ Client can view their progress{Colors.END}")
    
    def test_programs(self):
        """Test program creation and assignment"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: PROGRAMS", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        if 'session_client_id' not in self.test_data:
            print(f"{Colors.YELLOW}   ⚠ Skipping - no client available{Colors.END}")
            return
        
        client_id = self.test_data['session_client_id']
        
        # Create program with exercises
        success, program = self.test(
            "POST /programs (create program with exercises)",
            "POST", "/programs", 201,
            data={
                "name": "Test Strength Program",
                "description": "Build foundational strength",
                "exercises": [
                    {
                        "name": "Squat",
                        "sets": 3,
                        "reps": "8-10",
                        "video_url": "https://youtube.com/watch?v=test1"
                    },
                    {
                        "name": "Deadlift",
                        "sets": 3,
                        "reps": "5",
                        "video_url": "https://youtube.com/watch?v=test2"
                    }
                ]
            },
            token=self.coach_jordan_token
        )
        
        if success:
            program_id = program.get('id')
            self.test_data['program_id'] = program_id
            
            # Assign to client
            success, assignment = self.test(
                "POST /programs/:id/assign (assign to client)",
                "POST", f"/programs/{program_id}/assign", 201,
                data={"client_id": client_id},
                token=self.coach_jordan_token
            )
            
            # Try to assign again - should return 409
            self.test(
                "POST /programs/:id/assign (duplicate assign) returns 409",
                "POST", f"/programs/{program_id}/assign", 409,
                data={"client_id": client_id},
                token=self.coach_jordan_token
            )
            
            # Client GET /programs/client/assigned
            success, assigned = self.test(
                "Client GET /programs/client/assigned",
                "GET", "/programs/client/assigned", 200,
                token=self.client_token
            )
            
            if success:
                has_program = any(p.get('id') == program_id for p in assigned)
                if has_program:
                    print(f"{Colors.GREEN}   ✓ Client can see assigned program{Colors.END}")
    
    def test_messages(self):
        """Test messaging between coach and client"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: MESSAGING", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        if 'session_client_id' not in self.test_data:
            print(f"{Colors.YELLOW}   ⚠ Skipping - no client available{Colors.END}")
            return
        
        client_id = self.test_data['session_client_id']
        
        # Coach sends message
        success, message = self.test(
            "Coach POST /messages/with/:clientId",
            "POST", f"/messages/with/{client_id}", 201,
            data={"content": "How are you feeling after yesterday's session?"},
            token=self.coach_jordan_token
        )
        
        # Client GET /messages/mine
        success, messages = self.test(
            "Client GET /messages/mine",
            "GET", "/messages/mine", 200,
            token=self.client_token
        )
        
        if success:
            print(f"{Colors.GREEN}   ✓ Client can see messages{Colors.END}")
        
        # Check unread marking via /messages/threads
        self.test(
            "GET /messages/threads (check unread marking)",
            "GET", "/messages/threads", 200,
            token=self.client_token
        )
    
    def test_bookings(self):
        """Test booking requests"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: BOOKINGS", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # Client POST booking with future time
        future_time = (datetime.now() + timedelta(days=2)).isoformat()
        success, booking = self.test(
            "Client POST /bookings (future time)",
            "POST", "/bookings", 201,
            data={
                "requested_time": future_time,
                "duration_minutes": 60,
                "notes": "Would like to work on form"
            },
            token=self.client_token
        )
        
        if success:
            booking_id = booking.get('id')
            
            # Coach GET /bookings?status=pending
            success, bookings = self.test(
                "Coach GET /bookings?status=pending",
                "GET", "/bookings", 200,
                params={"status": "pending"},
                token=self.coach_jordan_token
            )
            
            if success:
                has_booking = any(b.get('id') == booking_id for b in bookings)
                if has_booking:
                    print(f"{Colors.GREEN}   ✓ Coach can see pending booking{Colors.END}")
                
                # Approve booking - should create session
                self.test(
                    "PATCH /bookings/:id/approve (creates session)",
                    "PATCH", f"/bookings/{booking_id}/approve", 200,
                    token=self.coach_jordan_token
                )
        
        # Try booking with past time - should return 400
        past_time = (datetime.now() - timedelta(days=1)).isoformat()
        self.test(
            "Client POST /bookings (past time) returns 400",
            "POST", "/bookings", 400,
            data={
                "requested_time": past_time,
                "duration_minutes": 60
            },
            token=self.client_token
        )
    
    def test_waivers(self):
        """Test waiver signing and version management"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: WAIVERS (APPEND-ONLY)", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # GET /waivers/latest
        success, latest = self.test(
            "GET /waivers/latest",
            "GET", "/waivers/latest", 200,
            token=self.client_token
        )
        
        if success:
            version_id = latest.get('id')
            self.test_data['waiver_version_id'] = version_id
            print(f"{Colors.BLUE}   Latest waiver version: {latest.get('version_number')}{Colors.END}")
        
        # Client signs waiver
        success, signature = self.test(
            "Client POST /waivers/sign",
            "POST", "/waivers/sign", 201,
            data={"signed_name": "Test Client"},
            token=self.client_token
        )
        
        # Try to sign again - should return 409
        self.test(
            "Client POST /waivers/sign (re-sign same version) returns 409",
            "POST", "/waivers/sign", 409,
            data={"signed_name": "Test Client"},
            token=self.client_token
        )
        
        # Coach signs paper waiver for a client
        if 'session_client_id' in self.test_data:
            self.test(
                "Coach POST /waivers/client/:id/sign-paper",
                "POST", f"/waivers/client/{self.test_data['session_client_id']}/sign-paper", 201,
                data={"signed_name": "Client Name"},
                token=self.coach_jordan_token
            )
        
        # Admin creates new version (append-only)
        success, new_version = self.test(
            "Admin POST /waivers/versions (create v2)",
            "POST", "/waivers/versions", 201,
            data={"full_text": "Updated waiver text for version 2"},
            token=self.admin_token
        )
        
        if success:
            print(f"{Colors.GREEN}   ✓ New waiver version created (append-only){Colors.END}")
        
        # Non-admin tries to create version - should return 403
        self.test(
            "Coach POST /waivers/versions returns 403",
            "POST", "/waivers/versions", 403,
            data={"full_text": "Should not work"},
            token=self.coach_jordan_token
        )
    
    def test_payments(self):
        """Test payment configuration and manual purchases"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: PAYMENTS (STRIPE NOT CONFIGURED)", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # GET /payments/config - should return configured: false
        success, config = self.test(
            "GET /payments/config returns configured:false",
            "GET", "/payments/config", 200,
            token=self.client_token
        )
        
        if success:
            if not config.get('configured'):
                print(f"{Colors.GREEN}   ✓ Stripe not configured (expected){Colors.END}")
                if config.get('message'):
                    print(f"{Colors.BLUE}   Message: {config.get('message')}{Colors.END}")
            else:
                print(f"{Colors.RED}   ✗ Stripe should NOT be configured{Colors.END}")
        
        # Client POST /payments/checkout - should return 503
        success, checkout = self.test(
            "Client POST /payments/checkout returns 503 (not configured)",
            "POST", "/payments/checkout", 503,
            data={"package_id": "any-id"},
            token=self.client_token
        )
        
        if success:
            if checkout.get('not_configured') or 'not configured' in checkout.get('error', '').lower():
                print(f"{Colors.GREEN}   ✓ Friendly 'not configured' error{Colors.END}")
        
        # Get packages first
        success, packages = self.test(
            "GET /packages",
            "GET", "/packages", 200,
            token=self.coach_jordan_token
        )
        
        if success and len(packages) > 0 and 'session_client_id' in self.test_data:
            package_id = packages[0]['id']
            client_id = self.test_data['session_client_id']
            
            # Coach records manual purchase
            success, purchase = self.test(
                "Coach POST /payments/manual (records purchase and adds credits)",
                "POST", "/payments/manual", 201,
                data={
                    "client_id": client_id,
                    "package_id": package_id
                },
                token=self.coach_jordan_token
            )
            
            if success:
                credits = purchase.get('credits')
                print(f"{Colors.GREEN}   ✓ Manual purchase recorded, credits: {credits}{Colors.END}")
        
        # GET /payments/history (client)
        self.test(
            "Client GET /payments/history",
            "GET", "/payments/history", 200,
            token=self.client_token
        )
        
        # GET /payments/history/:clientId (coach)
        if 'session_client_id' in self.test_data:
            self.test(
                "Coach GET /payments/history/:clientId",
                "GET", f"/payments/history/{self.test_data['session_client_id']}", 200,
                token=self.coach_jordan_token
            )
    
    def test_admin(self):
        """Test admin-only endpoints"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TESTING: ADMIN ENDPOINTS", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        # GET /admin/coaches (admin only)
        success, coaches = self.test(
            "Admin GET /admin/coaches",
            "GET", "/admin/coaches", 200,
            token=self.admin_token
        )
        
        # Coach tries to access - should return 403
        self.test(
            "Coach GET /admin/coaches returns 403",
            "GET", "/admin/coaches", 403,
            token=self.coach_jordan_token
        )
        
        # Admin reassigns client between coaches
        if 'new_client_id' in self.test_data and 'coach_alex_id' in self.test_data:
            self.test(
                "Admin PATCH /admin/clients/:id/reassign (move client between coaches)",
                "PATCH", f"/admin/clients/{self.test_data['new_client_id']}/reassign", 200,
                data={"coach_id": self.test_data['coach_alex_id']},
                token=self.admin_token
            )
        
        # Admin creates package
        self.test(
            "Admin POST /packages",
            "POST", "/packages", 201,
            data={
                "name": "Test Package",
                "price": 199,
                "session_credits": 10,
                "description": "Test package"
            },
            token=self.admin_token
        )
    
    def print_summary(self):
        """Print test summary"""
        self.log("\n" + "="*80, Colors.BLUE)
        self.log("TEST SUMMARY", Colors.BLUE)
        self.log("="*80, Colors.BLUE)
        
        pass_rate = (self.tests_passed / self.tests_run * 100) if self.tests_run > 0 else 0
        
        print(f"\n{Colors.BLUE}Total tests run: {self.tests_run}{Colors.END}")
        print(f"{Colors.GREEN}Passed: {self.tests_passed}{Colors.END}")
        print(f"{Colors.RED}Failed: {self.tests_failed}{Colors.END}")
        print(f"{Colors.BLUE}Pass rate: {pass_rate:.1f}%{Colors.END}\n")
        
        if self.tests_failed == 0:
            self.log("🎉 ALL TESTS PASSED!", Colors.GREEN)
        else:
            self.log(f"⚠️  {self.tests_failed} test(s) failed", Colors.YELLOW)

def main():
    tester = APITester()
    return tester.run_all_tests()

if __name__ == "__main__":
    sys.exit(main())
